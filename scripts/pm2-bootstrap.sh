#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[pm2-bootstrap] python3 nije pronađen. Instaliraj python3 i pokreni ponovno." >&2
  exit 1
fi

if [[ ! -d ".venv" ]]; then
  echo "[pm2-bootstrap] Kreiram .venv ..."
  python3 -m venv .venv
fi

VENV_PY="$ROOT_DIR/.venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "[pm2-bootstrap] .venv python nije dostupan na $VENV_PY" >&2
  exit 1
fi

echo "[pm2-bootstrap] Instaliram Python pakete iz requirements.txt ..."
"$VENV_PY" -m pip install --upgrade pip
"$VENV_PY" -m pip install -r "$ROOT_DIR/requirements.txt"

echo "[pm2-bootstrap] Pokrećem PM2 proces etherx-browser ..."
npx pm2 start ecosystem.config.cjs --update-env
npx pm2 save

echo "[pm2-bootstrap] Gotovo. PM2 status:"
npx pm2 status
