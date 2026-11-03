import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="finlex-test-")
os.environ.update({
    "FINLEX_ENV": "test",
    "FINLEX_DATABASE_URL": os.environ.get("FINLEX_TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.db"),
    "FINLEX_MARKET_DATA_MODE": "synthetic",
    "FINLEX_SCHEDULER_ENABLED": "false",
    "FINLEX_BOOTSTRAP_ON_START": "false",
    "FINLEX_NEWS_FEEDS": "",
    "FINLEX_ANTHROPIC_API_KEY": "",
    "FINLEX_SECRET_KEY": "test-secret-key-0123456789-abcdefghijklmnopqrstuvwxyz",
    "FINLEX_ADMIN_EMAILS": "admin@example.com",
})

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.services import scheduler  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        db = SessionLocal()
        scheduler.job_bootstrap(db)
        db.close()
        scheduler._state["prices_ready"] = True
        scheduler._state["bootstrapped"] = True
        yield c


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


def _session(client: TestClient, email: str, password: str = "Passw0rdX") -> TestClient:
    c = TestClient(app)
    r = c.post("/api/auth/register", json={"email": email, "password": password, "name": "T", "accept_terms": True})
    assert r.status_code == 200, r.text
    c.headers.update({"X-CSRF-Token": c.cookies.get("finlex_csrf")})
    return c


@pytest.fixture
def make_user(client):
    counter = {"n": 0}

    def make(prefix: str = "user") -> TestClient:
        counter["n"] += 1
        return _session(client, f"{prefix}{counter['n']}-{os.urandom(3).hex()}@example.com")

    return make
