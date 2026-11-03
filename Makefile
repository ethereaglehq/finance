.PHONY: setup dev-api dev-web test build run docker

setup:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm ci

dev-api:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

dev-web:
	cd frontend && npm run dev

test:
	cd backend && .venv/bin/python -m pytest -q
	cd frontend && npx tsc -b --noEmit

build:
	cd frontend && npm run build

run: build
	cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

docker:
	docker compose up --build
