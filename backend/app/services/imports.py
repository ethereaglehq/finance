"""Statement & CSV imports with a review-before-import workflow.

Flow: upload → parse → match each row to the instrument master (or AMFI / Yahoo for new
instruments) → user reviews (fix ambiguous/unmatched rows, include/exclude) → confirm → holdings.
Uploaded files are processed in memory and never stored; only the parsed rows are kept on the
pending batch until it is confirmed or discarded.
"""
from __future__ import annotations

import csv
import datetime as dt
import difflib
import io
import re
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Holding, ImportBatch, Instrument, Portfolio, Transaction
from . import marketdata as md
from . import portfolio as pfs

CSV_COLUMNS = ["asset_type", "identifier", "side", "quantity", "price", "trade_date", "account", "fees",
               "purity", "fd_rate", "fd_maturity_date", "fd_compounding", "notes"]
CSV_TEMPLATE = (
    ",".join(CSV_COLUMNS) + "\n"
    "stock,RELIANCE,BUY,10,1350.50,2024-03-15,Zerodha,20,,,,,\n"
    "etf,GOLDBEES,BUY,100,62.10,2024-05-02,Zerodha,0,,,,,\n"
    "mf,122639,BUY,250.123,64.25,2023-11-10,CAMS,0,,,,,SIP\n"
    "mf,HDFC Mid Cap Fund - Direct Plan - Growth,BUY,40,180.2,2024-01-05,Groww,0,,,,,\n"
    "gold,physical,BUY,20,6100,2022-10-24,Home locker,0,0.916,,,,22K jewellery coins\n"
    "fd,HDFC Bank,BUY,1,200000,2025-04-01,HDFC Bank,0,,7.1,2027-04-01,quarterly,\n"
)
ASSET_ALIASES = {"stock": "stock", "equity": "stock", "share": "stock", "shares": "stock", "mf": "mf",
                 "mutual fund": "mf", "mutual_fund": "mf", "fund": "mf", "etf": "etf", "gold": "gold",
                 "silver": "silver", "fd": "fd", "fixed deposit": "fd", "deposit": "fd"}
MAX_ROWS = 2000


class ImportError_(ValueError):
    pass


def parse_date(s: str) -> dt.date:
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unrecognised date '{s}' (use YYYY-MM-DD)")


def _f(s: str | None, default: float | None = None) -> float | None:
    if s is None or str(s).strip() == "":
        return default
    return float(str(s).replace(",", "").replace("₹", "").strip())


# ------------------------------------------------------------------ matching
class Matcher:
    def __init__(self, db: Session):
        self.db = db
        self.by_symbol = {i.symbol: i for i in db.scalars(select(Instrument))}
        self.by_isin = {i.isin: i for i in self.by_symbol.values() if i.isin}
        self.by_amfi = {i.amfi_code: i for i in self.by_symbol.values() if i.amfi_code}
        self._amfi_rows: list[dict] | None = None
        self._yahoo_cache: dict[str, dict | None] = {}

    @property
    def amfi(self) -> list[dict]:
        if self._amfi_rows is None:
            self._amfi_rows = md.amfi_schemes()
        return self._amfi_rows

    def _inst(self, i: Instrument) -> dict:
        return {"key": f"id:{i.id}", "name": i.name, "symbol": i.symbol, "asset_class": i.asset_class}

    def equity(self, ident: str, etf: bool = False) -> tuple[str, dict | None, list]:
        sym = ident.strip().upper().removesuffix(".NS").removesuffix(".BO")
        if (i := self.by_symbol.get(sym)) and i.asset_class in ("equity", "etf", "index"):
            return "ok", self._inst(i), []
        if (i := self.by_isin.get(sym)):
            return "ok", self._inst(i), []
        if get_mode() != "synthetic" and re.fullmatch(r"[A-Z0-9&\-]{1,20}", sym):
            if sym not in self._yahoo_cache:
                try:
                    df = md.fetch_yahoo(f"{sym}.NS", "5d")
                    q = df.attrs.get("quote", {})
                    self._yahoo_cache[sym] = {"key": f"yahoo:{sym}", "name": q.get("name") or sym, "symbol": sym,
                                              "asset_class": "etf" if etf else "equity"} if len(df) else None
                except Exception:  # noqa: BLE001
                    self._yahoo_cache[sym] = None
            if self._yahoo_cache[sym]:
                return "new", self._yahoo_cache[sym], []
        cands = difflib.get_close_matches(sym, [s for s, i in self.by_symbol.items()
                                                if i.asset_class in ("equity", "etf")], n=3, cutoff=0.6)
        return ("ambiguous" if cands else "unmatched"), None, [self._inst(self.by_symbol[c]) for c in cands]

    def mutual_fund(self, ident: str, isin: str | None = None) -> tuple[str, dict | None, list]:
        ident = ident.strip()
        code = ident if ident.isdigit() else None
        if code and (i := self.by_amfi.get(code)):
            return "ok", self._inst(i), []
        if isin and (i := self.by_isin.get(isin)):
            return "ok", self._inst(i), []
        if re.fullmatch(r"INF[A-Z0-9]{9}", ident.upper()):
            isin = ident.upper()
            if (i := self.by_isin.get(isin)):
                return "ok", self._inst(i), []
        for r in self.amfi:
            if (code and r["code"] == code) or (isin and r["isin"] == isin):
                if (i := self.by_amfi.get(r["code"])):
                    return "ok", self._inst(i), []
                return "new", {"key": f"amfi:{r['code']}", "name": r["name"], "symbol": f"MF{r['code']}",
                               "asset_class": "mf"}, []
        # fuzzy name match against master + AMFI list
        pool = {i.name: self._inst(i) for i in self.by_symbol.values() if i.asset_class == "mf"}
        for r in self.amfi:
            if "direct" in r["name"].lower() or "regular" in r["name"].lower():
                pool.setdefault(r["name"], {"key": f"amfi:{r['code']}", "name": r["name"],
                                            "symbol": f"MF{r['code']}", "asset_class": "mf"})
        norm = lambda s: re.sub(r"[^a-z0-9 ]", " ", s.lower())  # noqa: E731
        names = list(pool)
        scored = sorted(((difflib.SequenceMatcher(None, norm(ident), norm(n)).ratio(), n) for n in
                         difflib.get_close_matches(ident, names, n=8, cutoff=0.45)), reverse=True)
        cands = [{**pool[n], "score": round(s, 3)} for s, n in scored[:5]]
        if cands and cands[0]["score"] >= 0.93 and (len(cands) == 1 or cands[1]["score"] < 0.9):
            st = "ok" if cands[0]["key"].startswith("id:") else "new"
            return st, {k: v for k, v in cands[0].items() if k != "score"}, []
        return ("ambiguous" if cands else "unmatched"), None, cands

    def metal(self, kind: str) -> tuple[str, dict | None, list]:
        i = self.by_symbol.get("GOLD" if kind == "gold" else "SILVER")
        return ("ok", self._inst(i), []) if i else ("unmatched", None, [])

    def fd(self) -> tuple[str, dict | None, list]:
        i = self.by_symbol.get("FD")
        return ("ok", self._inst(i), []) if i else ("unmatched", None, [])


def get_mode() -> str:
    from ..config import get_settings

    return get_settings().market_data_mode


# ------------------------------------------------------------------ CSV
def parse_csv(db: Session, content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ImportError_("The CSV is empty.")
    fields = {f.strip().lower() for f in reader.fieldnames if f}
    missing = {"asset_type", "identifier", "quantity", "price", "trade_date"} - fields
    if missing:
        raise ImportError_(f"Missing required column(s): {', '.join(sorted(missing))}. Download the template.")
    m = Matcher(db)
    rows = []
    for n, raw in enumerate(reader, start=2):
        if n - 1 > MAX_ROWS:
            raise ImportError_(f"Too many rows (max {MAX_ROWS}).")
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        if not any(r.values()):
            continue
        row = {"row": n, "raw": r, "errors": [], "include": True, "candidates": [], "match": None, "meta": {}}
        try:
            at = ASSET_ALIASES.get(r.get("asset_type", "").lower())
            if not at:
                raise ValueError(f"unknown asset_type '{r.get('asset_type')}'")
            row["asset_type"] = at
            row["identifier"] = r.get("identifier", "")
            row["side"] = (r.get("side") or "BUY").upper()
            if row["side"] not in ("BUY", "SELL"):
                raise ValueError("side must be BUY or SELL")
            row["quantity"] = _f(r.get("quantity"), 1.0 if at == "fd" else None)
            row["price"] = _f(r.get("price"))
            row["fees"] = _f(r.get("fees"), 0.0)
            row["trade_date"] = parse_date(r.get("trade_date", "")).isoformat()
            row["account"] = r.get("account") or None
            row["notes"] = r.get("notes", "")[:500]
            if row["quantity"] is None or row["quantity"] <= 0:
                raise ValueError("quantity must be a positive number")
            if row["price"] is None or row["price"] < 0:
                raise ValueError("price must be a non-negative number")
            if dt.date.fromisoformat(row["trade_date"]) > md.today_ist():
                raise ValueError("trade_date is in the future")
            if at == "fd":
                row["meta"] = {"principal": row["price"] * row["quantity"], "rate": _f(r.get("fd_rate")),
                               "start_date": row["trade_date"],
                               "maturity_date": parse_date(r.get("fd_maturity_date", "")).isoformat(),
                               "compounding": (r.get("fd_compounding") or "quarterly").lower(),
                               "bank": row["identifier"] or "Bank"}
                if not row["meta"]["rate"]:
                    raise ValueError("fd_rate is required for fixed deposits")
                if row["meta"]["compounding"] not in pfs.COMPOUNDING:
                    raise ValueError(f"fd_compounding must be one of {', '.join(pfs.COMPOUNDING)}")
            if at in ("gold", "silver"):
                purity = _f(r.get("purity"), 0.999)
                if not 0 < purity <= 1:
                    raise ValueError("purity must be between 0 and 1 (e.g. 0.999 or 0.916)")
                row["meta"] = {"purity": purity, "form": "physical"}
        except (ValueError, TypeError) as e:
            row["status"] = "invalid"
            row["errors"].append(str(e))
            row["include"] = False
            rows.append(row)
            continue
        at = row["asset_type"]
        if at in ("stock", "etf"):
            st, match, cands = m.equity(row["identifier"], etf=at == "etf")
        elif at == "mf":
            st, match, cands = m.mutual_fund(row["identifier"])
        elif at in ("gold", "silver"):
            st, match, cands = m.metal(at)
        else:
            st, match, cands = m.fd()
        row.update(status=st, match=match, candidates=cands)
        if st in ("ambiguous", "unmatched"):
            row["include"] = False
            row["errors"].append("Instrument needs review: pick a match or exclude this row." if cands else
                                 "No matching instrument found.")
        rows.append(row)
    if not rows:
        raise ImportError_("No data rows found in the CSV.")
    return rows


# ------------------------------------------------------------------ CAS PDF
TX_BUY = {"PURCHASE", "PURCHASE_SIP", "SWITCH_IN", "SWITCH_IN_MERGER", "DIVIDEND_REINVEST", "GIFT_IN"}
TX_SELL = {"REDEMPTION", "SWITCH_OUT", "SWITCH_OUT_MERGER", "GIFT_OUT"}
TX_FEE = {"STAMP_DUTY_TAX", "STT_TAX"}


def _d(x) -> float:
    return float(x) if isinstance(x, (Decimal, int, float)) else float(str(x or 0).replace(",", "") or 0)


def _date(x) -> dt.date:
    return x if isinstance(x, dt.date) else parse_date(str(x))


def parse_cas(db: Session, content: bytes, password: str) -> tuple[list[dict], dict]:
    if content[:5] != b"%PDF-":
        raise ImportError_("This doesn't look like a PDF file.")
    try:
        import casparser
        from casparser.exceptions import CASParseError, IncorrectPasswordError
    except ImportError as e:  # pragma: no cover
        raise ImportError_("Statement parsing library is not installed on this server.") from e
    try:
        data = casparser.read_cas_pdf(io.BytesIO(content), password)
    except IncorrectPasswordError as e:
        raise ImportError_("Incorrect PDF password (CAMS/KFintech statements usually use your PAN).") from e
    except CASParseError as e:
        raise ImportError_(f"Could not read this statement: {e}") from e
    except Exception as e:  # noqa: BLE001
        raise ImportError_(f"Unsupported or damaged statement: {type(e).__name__}") from e
    m = Matcher(db)
    rows: list[dict] = []
    n = 0
    info = {"warnings": list(getattr(data, "parse_warnings", []) or [])}
    period = getattr(data, "statement_period", None)
    info["statement_period"] = {"from": getattr(period, "from_", None), "to": getattr(period, "to", None)}
    if hasattr(data, "folios"):  # CAMS / KFintech
        info["type"] = "CAMS/KFintech CAS"
        for folio in data.folios:
            account = f"{folio.amc.replace(' Mutual Fund', '')} · folio {folio.folio}"[:120]
            for sch in folio.schemes:
                st, match, cands = m.mutual_fund(sch.amfi or sch.scheme, isin=sch.isin)
                if st in ("ambiguous", "unmatched") and sch.amfi:
                    match = {"key": f"amfi:{sch.amfi}", "name": sch.scheme, "symbol": f"MF{sch.amfi}", "asset_class": "mf"}
                    st = "new"
                close = _d(sch.close)
                txs = sorted(sch.transactions, key=lambda t: _date(t.date))
                fees_by_date: dict[dt.date, float] = defaultdict(float)
                tx_rows = []
                units_net = 0.0
                for t in txs:
                    ttype = t.type if isinstance(t.type, str) else t.type.value
                    if ttype in TX_FEE:
                        fees_by_date[_date(t.date)] += abs(_d(t.amount))
                        continue
                    units = abs(_d(t.units)) if t.units is not None else 0.0
                    if units <= 0:
                        continue
                    nav = _d(t.nav) if t.nav else (abs(_d(t.amount)) / units if t.amount else 0.0)
                    side = "BUY" if ttype in TX_BUY else "SELL" if ttype in TX_SELL else None
                    if side is None:
                        continue
                    units_net += units if side == "BUY" else -units
                    tx_rows.append({"side": side, "quantity": units, "price": nav,
                                    "trade_date": _date(t.date).isoformat(), "notes": t.description[:200]})
                complete = tx_rows and abs(units_net - close) < 0.01 + 1e-6 * close
                if not complete:
                    if close <= 0:
                        continue
                    cost = _d(sch.valuation.cost) if sch.valuation.cost else close * _d(sch.valuation.nav)
                    start = info["statement_period"]["from"]
                    tx_rows = [{"side": "BUY", "quantity": close, "price": cost / close,
                                "trade_date": parse_date(start).isoformat() if start else _date(sch.valuation.date).isoformat(),
                                "notes": "Summary row: statement transactions incomplete; cost basis from statement"}]
                for tr in tx_rows:
                    n += 1
                    d = dt.date.fromisoformat(tr["trade_date"])
                    rows.append({"row": n, "asset_type": "mf", "identifier": sch.amfi or sch.isin or sch.scheme,
                                 "name": sch.scheme, "account": account, "fees": fees_by_date.pop(d, 0.0)
                                 if tr["side"] == "BUY" else 0.0, "meta": {}, "status": st, "match": match,
                                 "candidates": cands, "errors": [] if match else ["Scheme not matched"],
                                 "include": bool(match), **tr})
    else:  # NSDL / CDSL depository CAS
        info["type"] = "NSDL/CDSL CAS"
        stmt_date = info["statement_period"]["to"]
        when = parse_date(stmt_date).isoformat() if stmt_date else md.today_ist().isoformat()
        for acc in data.accounts:
            account = f"{acc.name} · {acc.client_id or acc.dp_id or acc.type}"[:120]
            for eq in acc.equities:
                ident = eq.symbol or eq.isin
                st, match, cands = m.equity(ident)
                qty = _d(eq.num_shares)
                if qty <= 0:
                    continue
                n += 1
                rows.append({"row": n, "asset_type": "stock", "identifier": ident, "name": eq.name, "side": "BUY",
                             "quantity": qty, "price": _d(eq.price), "trade_date": when, "account": account,
                             "fees": 0.0, "meta": {}, "status": st, "match": match, "candidates": cands,
                             "errors": [] if match else ["Instrument needs review"], "include": bool(match),
                             "notes": "Depository statements show holdings, not purchase cost: cost set to the "
                                      "statement price. Edit transactions to enter your actual cost."})
            for mf in acc.mutual_funds:
                st, match, cands = m.mutual_fund(mf.amfi or mf.isin, isin=mf.isin)
                qty = _d(mf.balance)
                if qty <= 0:
                    continue
                price = _d(mf.avg_cost) if mf.avg_cost else _d(mf.nav)
                n += 1
                rows.append({"row": n, "asset_type": "mf", "identifier": mf.amfi or mf.isin, "name": mf.name,
                             "side": "BUY", "quantity": qty, "price": price, "trade_date": when, "account": account,
                             "fees": 0.0, "meta": {}, "status": st, "match": match, "candidates": cands,
                             "errors": [] if match else ["Scheme not matched"], "include": bool(match),
                             "notes": "From depository statement"})
    if not rows:
        raise ImportError_("No holdings found in this statement.")
    return rows, info


# ------------------------------------------------------------------ batch lifecycle
def summarise(rows: list[dict]) -> dict:
    inc = [r for r in rows if r.get("include")]
    by_type: dict[str, float] = defaultdict(float)
    for r in inc:
        amt = r["quantity"] * r["price"] * (1 if r["side"] == "BUY" else -1)
        by_type[r["asset_type"]] += amt
    status: dict[str, int] = defaultdict(int)
    for r in rows:
        status[r.get("status", "invalid")] += 1
    return {"rows": len(rows), "included": len(inc), "excluded": len(rows) - len(inc), "by_status": dict(status),
            "net_invested_by_type": dict(by_type), "net_invested": sum(by_type.values())}


def create_batch(db: Session, user_id: int, kind: str, filename: str, rows: list[dict], info: dict | None = None) -> ImportBatch:
    b = ImportBatch(user_id=user_id, kind=kind, filename=filename[:255], rows=rows,
                    summary={**summarise(rows), **(info or {})})
    db.add(b)
    db.commit()
    return b


def resolve_key(db: Session, key: str, asset_type: str) -> Instrument:
    kind, _, val = key.partition(":")
    if kind == "id":
        inst = db.get(Instrument, int(val))
        if not inst:
            raise ValueError("instrument not found")
        return inst
    if kind == "amfi":
        inst = db.scalar(select(Instrument).where(Instrument.amfi_code == val))
        if inst:
            return inst
        name = next((r["name"] for r in md.amfi_schemes() if r["code"] == val), f"AMFI scheme {val}")
        inst = md.create_mf_instrument(db, val, name)
        md.refresh_instruments(db, [inst])
        return inst
    if kind == "yahoo":
        sym = val.upper()
        inst = db.scalar(select(Instrument).where(Instrument.symbol == sym))
        if inst:
            return inst
        df = md.fetch_yahoo(f"{sym}.NS", "5d")
        name = df.attrs.get("quote", {}).get("name") or sym
        inst = Instrument(symbol=sym, name=name, asset_class="etf" if asset_type == "etf" else "equity", exchange="NSE",
                          sector="Unclassified", category="Unclassified", provider="yahoo", provider_symbol=f"{sym}.NS",
                          unit="share" if asset_type != "etf" else "unit", in_universe=True, meta={})
        db.add(inst)
        db.commit()
        md.refresh_instruments(db, [inst])
        return inst
    raise ValueError(f"bad instrument key {key}")


def confirm(db: Session, pf: Portfolio, batch: ImportBatch, decisions: dict[str, dict], default_account: str | None) -> dict:
    if batch.status != "pending":
        raise ImportError_("This import was already processed.")
    rows = [dict(r) for r in batch.rows]
    for r in rows:
        d = decisions.get(str(r["row"]))
        if d:
            if "include" in d:
                r["include"] = bool(d["include"])
            if d.get("key"):
                r["match"] = {"key": d["key"]}
    created, skipped, errors = 0, 0, []
    cache: dict[str, Instrument] = {}
    rows.sort(key=lambda r: (r.get("trade_date") or "", 0 if r.get("side") == "BUY" else 1))
    for r in rows:
        if not r.get("include") or r.get("status") == "invalid" or not r.get("match"):
            skipped += 1
            continue
        try:
            key = r["match"]["key"]
            inst = cache.get(key) or resolve_key(db, key, r["asset_type"])
            cache[key] = inst
            account = pfs.get_or_create_account(db, pf, r.get("account") or default_account or "Imported",
                                                "mf" if r["asset_type"] == "mf" else "broker")
            d = dt.date.fromisoformat(r["trade_date"])
            if r["asset_type"] == "fd":
                m = r["meta"]
                pfs.add_fd(db, pf, inst, float(m["principal"]), float(m["rate"]), dt.date.fromisoformat(m["start_date"]),
                           dt.date.fromisoformat(m["maturity_date"]), m["compounding"], m.get("bank", ""), account)
            elif r["side"] == "BUY":
                pfs.add_position(db, pf, inst, float(r["quantity"]), float(r["price"]), d, account,
                                 fees=float(r.get("fees") or 0), meta=r.get("meta") or None,
                                 source=batch.kind, notes=r.get("notes", "")[:500])
            else:
                h = db.scalar(select(Holding).where(Holding.portfolio_id == pf.id, Holding.instrument_id == inst.id,
                                                    Holding.account_id == account.id))
                if h is None:
                    raise ValueError("sell without a prior position")
                db.add(Transaction(holding_id=h.id, type="SELL", quantity=float(r["quantity"]), price=float(r["price"]),
                         fees=float(r.get("fees") or 0), trade_date=d, source=batch.kind))
                db.flush()
                db.refresh(h)
                pfs.recompute(h)
            db.commit()
            created += 1
        except Exception as e:  # noqa: BLE001
            db.rollback()
            errors.append({"row": r["row"], "error": str(e)})
    batch.status = "confirmed"
    batch.summary = {**batch.summary, "result": {"imported": created, "skipped": skipped, "errors": errors}}
    batch.rows = []  # do not retain parsed statement rows after import
    db.commit()
    return {"imported": created, "skipped": skipped, "errors": errors}
