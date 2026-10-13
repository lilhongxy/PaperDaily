import os
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
PDF_DIR = DATA_DIR / "pdfs"
TEXT_DIR = DATA_DIR / "text"
DB_PATH = DATA_DIR / "dailypaper.db"
ENV_PATH = ROOT / "backend" / ".env"

for d in (DATA_DIR, PDF_DIR, TEXT_DIR):
    d.mkdir(parents=True, exist_ok=True)


def llm_credentials() -> dict:
    """Values in backend/.env win; blank entries fall back to the shell environment
    (e.g. an ANTHROPIC_API_KEY exported in your shell profile)."""
    file_vals = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}

    def pick(name: str) -> str | None:
        return (file_vals.get(name) or "").strip() or os.environ.get(name, "").strip() or None

    return {
        "base_url": pick("ANTHROPIC_BASE_URL"),
        "auth_token": pick("ANTHROPIC_AUTH_TOKEN"),
        "api_key": pick("ANTHROPIC_API_KEY"),
    }


# Shown in the model pickers; users can add more in Settings or fetch from the API.
DEFAULT_MODELS = [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
]

DEFAULT_SETTINGS = {
    "interest": "",
    "categories": ["cs.CL", "cs.LG", "cs.AI"],
    "keywords": [],
    "push_count": 10,
    "push_days": 2,
    "max_candidates": 150,
    "push_model": "claude-opus-5-5",
    "reader_model": "claude-opus-5-5",
    "custom_models": [],
    "trend_count": 20,
    "trend_days": 7,
    "research_max": 30,
}
