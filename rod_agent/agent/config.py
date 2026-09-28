"""경로·환경설정. 모든 경로는 프로그램 폴더 기준 상대경로로 잡는다."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = APP_DIR / ".env"

load_dotenv(ENV_PATH)

DATA_DIR = APP_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
SESSION_DIR = DATA_DIR / "sessions"
ASSET_DIR = APP_DIR / "assets"
STATIC_DIR = APP_DIR / "static"

MODELS = {
    "claude-opus-5": "Opus 5 (고품질·기본)",
    "claude-sonnet-5": "Sonnet 5 (빠름·저렴)",
}
DEFAULT_MODEL = "claude-opus-5"
EFFORTS = ("low", "medium", "high")

HOST = "127.0.0.1"


def output_dir() -> Path:
    raw = os.getenv("OUTPUT_DIR", "").strip()
    path = Path(raw).expanduser() if raw else APP_DIR / "outputs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def port() -> int:
    try:
        return int(os.getenv("PORT", "8000"))
    except ValueError:
        return 8000


def default_model() -> str:
    model = os.getenv("CLAUDE_MODEL", DEFAULT_MODEL).strip()
    return model or DEFAULT_MODEL


def has_api_key() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY", "").strip())


def save_env(updates: dict[str, str]) -> None:
    """`.env`의 키를 갱신(없으면 추가)하고 현재 프로세스에도 반영한다."""
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    remaining = dict(updates)
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip()
        if key in remaining:
            out.append(f"{key}={remaining.pop(key)}")
        else:
            out.append(line)
    out.extend(f"{k}={v}" for k, v in remaining.items())
    ENV_PATH.write_text("\n".join(out) + "\n", encoding="utf-8")
    for k, v in updates.items():
        os.environ[k] = v


def ensure_dirs() -> None:
    for d in (UPLOAD_DIR, SESSION_DIR):
        d.mkdir(parents=True, exist_ok=True)
    output_dir()
