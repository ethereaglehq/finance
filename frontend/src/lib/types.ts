/* API payload types (mirror backend responses). */

export interface Prefs {
  risk_level: "conservative" | "moderate" | "aggressive";
  horizon_years: number;
  company_threshold_pct: number;
  sector_threshold_pct: number;
  goals: string[];
  onboarded: boolean;
}

export interface User {
  id: number;
  email: string;
  name: string;
  is_demo: boolean;
  preferences: Prefs;
  consent_llm: boolean;
  created_at: string;
}

export interface Quote {
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
  as_of: string;
  source: string;
  delay_note: string;
  synthetic: boolean;
  stale: boolean;
}

export interface InstrumentRef {
  id: number;
  symbol: string;
  name: string;
  asset_class: "equity" | "index" | "mf" | "etf" | "gold" | "silver" | "fd" | "cash";
  sector?: string | null;
  category?: string | null;
  exchange?: string;
  isin?: string | null;
  amfi_code?: string | null;
  unit?: string;
  in_universe?: boolean;
  quote?: Quote | null;
}

export interface HoldingRow {
  id: number;
  instrument: InstrumentRef;
  type_label: string;
  account: { id: number; label: string } | null;
  quantity: number;
  avg_cost: number;
  invested: number;
  price: number | null;
  value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  realised_pnl: number;
  day_change: number | null;
  day_change_pct: number | null;
  xirr: number | null;
  weight: number;
  as_of: string | null;
  source: string | null;
  delay_note: string | null;
  synthetic: boolean;
  stale: boolean;
  estimated: boolean;
  meta: Record<string, unknown>;
  source_kind: string;
  first_date: string | null;
  closed: boolean;
}

export interface AllocItem {
  label: string;
  value: number;
  pct: number;
}

export interface Issue {
  level: "error" | "warning" | "info";
  holding_id?: number;
  code: string;
  message: string;
}

export interface Totals {
  value: number;
  invested: number;
  pnl: number;
  pnl_pct: number;
  realised_pnl: number;
  day_change: number;
  day_change_pct: number;
  xirr: number | null;
  holdings: number;
  valued_at: string | null;
}

export interface Valuation {
  portfolio: { id: number; name: string; base_currency: string };
  totals: Totals;
  holdings: HoldingRow[];
  allocation: { by_type: AllocItem[]; by_account: AllocItem[]; by_sector: AllocItem[] };
  issues: Issue[];
  accounts: { id: number; label: string; account_type: string }[];
}

export interface HistoryResp {
  points: { date: string; value: number; invested: number }[];
  twr: number | null;
  period: string;
  start?: string;
  method?: string;
}

export interface Company {
  key: string;
  name: string;
  symbol: string | null;
  sector: string;
  direct: number;
  indirect: number;
  total: number;
  pct: number;
  n_sources: number;
  contributors: { via: string; value: number; kind: "direct" | "indirect" }[];
}

export interface Exposure {
  total_value: number;
  companies: Company[];
  sectors: { sector: string; value: number; pct: number }[];
  asset_mix: AllocItem[];
  unitemised_value: number;
  unitemised_pct: number;
  overlap: {
    funds: string[];
    matrix: number[][];
    pairs: { a: string; b: string; overlap_pct: number; n_common: number; common: { name: string; weight_a: number; weight_b: number; min: number }[] }[];
  };
  coverage: { holding_id: number; name: string; covered: boolean; disclosure_date: string | null; source: string | null; weight_sum?: number }[];
  flags: { type: string; name: string; pct: number; threshold: number; message: string }[];
  data_quality: {
    rules: { level: string; rule: string; message: string; scheme_id: number }[];
    autoencoder: {
      available: boolean;
      model?: string;
      threshold?: number;
      validation?: { synthetic_corruption_detection_rate: number; clean_flag_rate: number; n_corruptions: number; n_schemes: number };
      note?: string;
      reason?: string;
    };
    autoencoder_flags: { scheme_id: number; name: string; error: number; flagged: boolean }[];
    held_scores: Record<string, { name: string; error: number; flagged: boolean } | null>;
  };
  thresholds: { company_pct: number; sector_pct: number };
  method: string;
}

export interface Metrics {
  start: string;
  end: string;
  start_price: number;
  end_price: number;
  abs_change: number;
  total_return_pct: number;
  cagr_pct: number | null;
  ann_vol_pct: number | null;
  max_drawdown_pct: number;
  drawdown_peak: string | null;
  drawdown_trough: string | null;
  best_day_pct: number | null;
  worst_day_pct: number | null;
  n_obs: number;
}

export interface CompareResp {
  period: string;
  series: { instrument: InstrumentRef; metrics: Metrics; source: string | null; synthetic: boolean; quote: Quote | null }[];
  points: Record<string, number | string | null>[];
  correlation: { ids: number[]; matrix: number[][] } | null;
  warnings: string[];
  notes: string[];
}

export interface ModelMetrics {
  n: number;
  mae: number;
  rmse: number;
  directional_accuracy: number | null;
  coverage80: number;
  coverage50: number;
  width80: number;
  skill_vs_naive: number;
  beats_naive: "significant" | "marginal" | "no" | null;
  t_stat: number | null;
}

export interface Evaluation {
  horizon: number;
  metrics: Record<string, ModelMetrics>;
  dataset_hash: string;
  data_cutoff: string;
  train_start?: string;
  test_start?: string;
  test_end?: string;
  refit_every?: number;
  eval_step?: number;
  cached?: boolean;
  error?: string;
}

export interface Forecast {
  instrument: { id: number; symbol: string; name: string; unit: string };
  model: string;
  model_name: string;
  model_version: string;
  code_version: string;
  horizon_days: number;
  horizon_label: string;
  cutoff_date: string;
  target_date: string;
  base_price: number;
  point_return: number;
  interval80: [number, number];
  interval50: [number, number];
  price_point: number;
  price_interval80: [number, number];
  price_interval50: [number, number];
  training_window: [string, string] | null;
  n_train: number;
  n_calibration: number;
  interval_method: string;
  factors: { feature: string; label: string; weight: number; sign: "+" | "-" | null }[];
  dataset_hash: string;
  source: string | null;
  synthetic: boolean;
  disclaimer: string;
}

export interface ForecastResp {
  forecast: Forecast;
  chart: { date: string; price?: number; p?: number; band80?: [number, number]; band50?: [number, number] }[];
  evaluation: Evaluation;
  logged: { id: number; record_hash: string; created_at: string };
}

export interface ModelCard {
  id: string;
  name: string;
  kind: "baseline" | "model" | "experimental";
  desc: string;
  version?: string;
  available: boolean;
}

export interface TrackRecordRow {
  id: number;
  origin: "live" | "backtest";
  created_at: string;
  instrument: { id: number; symbol: string; name: string };
  model: string;
  model_name: string;
  model_version: string;
  horizon_days: number;
  cutoff_date: string;
  target_date: string;
  base_price: number;
  point_return: number;
  interval80: [number, number];
  interval50: [number, number];
  data_version: string;
  record_hash: string;
  outcome: null | {
    observed_date: string;
    observed_price: number;
    realised_return: number;
    error: number;
    inside80: boolean;
    inside50: boolean;
    direction_hit: boolean | null;
    note: string;
  };
}

export interface AggStats {
  n: number;
  coverage80?: number;
  coverage50?: number;
  mae?: number;
  rmse?: number;
  naive_mae?: number;
  skill_vs_naive?: number | null;
  directional_accuracy?: number | null;
  n_direction?: number;
  mean_width80?: number;
}

export interface TrackReport {
  origin: string;
  summary: AggStats & { pending: number; total: number };
  calibration: { nominal: number; observed: number | null }[];
  coverage_over_time: { month: string; coverage80: number; n: number }[];
  segments: Record<"instrument" | "model" | "horizon", (AggStats & { label: string })[]>;
  records: TrackRecordRow[];
  page: number;
  page_size: number;
  total: number;
  chain: { ok: boolean; checked: number; head?: string; broken_at?: number };
  notes: string[];
}

export interface BriefRow extends Quote {
  id: number;
  symbol: string;
  name: string;
  asset_class: string;
  unit: string;
  sector: string | null;
  week_change_pct: number | null;
  spark: number[];
}

export interface Mood {
  label: "positive" | "neutral" | "negative";
  score: number;
  n: number;
  counts: { positive: number; neutral: number; negative: number };
  score_0_100?: number;
}

export interface Brief {
  as_of: string | null;
  synthetic: boolean;
  summary: string;
  summary_engine: string;
  indices: BriefRow[];
  metals: BriefRow[];
  gainers: (Quote & { id: number; symbol: string; name: string; sector: string | null })[];
  losers: (Quote & { id: number; symbol: string; name: string; sector: string | null })[];
  sectors: { sector: string; avg_change_pct: number; n: number }[];
  breadth: { advancers: number; decliners: number; unchanged: number };
  news_mood: Mood;
  notes: string[];
}

export interface NewsItem {
  id: number;
  publisher: string;
  headline: string;
  summary: string;
  url: string;
  published_at: string;
  entities: string[];
  sentiment: { label: "positive" | "neutral" | "negative"; score: number; model: string };
  is_sample: boolean;
}

export interface FilingMetric {
  label: string;
  current: number;
  previous_quarter: number | null;
  year_ago_quarter: number | null;
  qoq_pct: number | null;
  yoy_pct: number | null;
  evidence: string;
}

export interface Filing {
  id: number;
  issuer: string;
  exchange: string;
  filing_type: string;
  period: string;
  published_at: string | null;
  source_uri: string;
  checksum: string;
  facts: {
    metrics: Record<string, FilingMetric>;
    risk_mentions: { term: string; snippet: string }[];
    net_margin_pct: number | null;
    unit: string;
    period: string | null;
    column_assumption: string;
    missing: string[];
  };
  summary: { reported: string; interpretation: string | null; interpretation_engine: string | null; generated_at: string };
  is_sample: boolean;
  instrument_id: number | null;
  private: boolean;
  text_excerpt?: string;
}

export interface Rule {
  id: string;
  title: string;
  condition: string;
  fired: boolean;
  facts: Record<string, unknown>;
  explanation: string;
  severity: "info" | "warning";
}

export interface Review {
  profile: { risk_level: string; horizon_years: number };
  current_allocation: { class: string; label: string; pct: number }[];
  rules: Rule[];
  fired: number;
  summary: string;
  disclaimer: string;
}

export interface PlanSolution {
  allocation: Record<string, number>;
  turnover_pct: number;
  hist_return_pct: number;
  hist_vol_pct: number;
}

export interface PlanResp {
  feasible: boolean;
  problems: string[];
  bounds?: Record<string, [number, number]>;
  vol_cap_pct?: number | null;
  risk_level?: string;
  current: Record<string, number>;
  current_stats?: { hist_return_pct: number | null; hist_vol_pct: number | null };
  violations_now: string[];
  solutions: PlanSolution[];
  search?: { algorithm: string; nodes_expanded: number; rejected_by_vol_cap: number; step_pct: number };
  risk_model?: { window: [string, string] | null; proxies: Record<string, string | null>; note: string };
  labels?: Record<string, string>;
  disclaimer?: string;
}

export interface ChatMsg {
  id?: number;
  role: "user" | "assistant";
  content: string;
  meta?: { engine?: string; citations?: { tool: string; detail: string; as_of: string | null }[]; guardrail?: string | null };
  created_at?: string;
}

export interface Alert {
  id: number;
  rule_type: string;
  rule_label: string;
  instrument: { id: number; symbol: string; name: string } | null;
  threshold: number;
  enabled: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

export interface AlertEvent {
  id: number;
  alert_id: number | null;
  message: string;
  read: boolean;
  triggered_at: string;
}

export interface Lesson {
  id: string;
  title: string;
  minutes: number;
  level: string;
  body: string[];
  quiz: { q: string; options: string[]; answer: number; explain: string }[];
  completed: boolean;
  score: number | null;
}

export interface GlossaryTerm {
  term: string;
  category: string;
  aliases: string[];
  definition: string;
  example?: string;
}

export interface SourceRow {
  key: string;
  domain: string;
  provider: string;
  licence: string;
  frequency: string;
  delay: string;
  limitations: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string;
  mode: string;
}

export interface ImportRow {
  row: number;
  asset_type: string;
  identifier: string;
  name?: string | null;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  trade_date: string;
  account: string | null;
  fees: number;
  meta: Record<string, unknown>;
  status: "ok" | "new" | "ambiguous" | "unmatched" | "invalid";
  match: { key: string; name?: string; symbol?: string; asset_class?: string } | null;
  candidates: { key: string; name: string; symbol?: string; score?: number }[];
  errors: string[];
  include: boolean;
  notes?: string;
  raw?: Record<string, string>;
}

export interface ImportBatch {
  id: number;
  kind: "csv" | "cas";
  filename: string;
  status: "pending" | "confirmed" | "discarded";
  rows: ImportRow[] | null;
  summary: {
    rows: number;
    included: number;
    excluded: number;
    by_status: Record<string, number>;
    net_invested_by_type: Record<string, number>;
    net_invested: number;
    type?: string;
    statement_period?: { from: string | null; to: string | null };
    warnings?: string[];
    result?: { imported: number; skipped: number; errors: { row: number; error: string }[] };
  };
  created_at: string;
}

export interface Dashboard {
  totals: Totals;
  allocation: Valuation["allocation"];
  issues: Issue[];
  top_holdings: HoldingRow[];
  movers: HoldingRow[];
  exposure: null | {
    companies: Company[];
    sectors: { sector: string; value: number; pct: number }[];
    flags: Exposure["flags"];
    asset_mix: AllocItem[];
    top_overlap: Exposure["overlap"]["pairs"];
  };
  market: { indices: BriefRow[]; metals: BriefRow[]; summary: string; as_of: string | null; synthetic: boolean; news_mood: Mood };
  unread_alerts: number;
}

export interface Status {
  version: string;
  market_data_mode: string;
  llm_configured: boolean;
  llm_model: string | null;
  scheduler: { bootstrapped: boolean; bootstrapping: boolean; prices_ready: boolean; last: Record<string, { at: string; status: string }> };
  instruments_with_prices: number;
  env: string;
}
