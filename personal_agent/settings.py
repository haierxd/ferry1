"""Backend-only configuration. Never return credentials in an API response."""
from dataclasses import dataclass, field
import os
from pathlib import Path

from dotenv import dotenv_values

AGENT_DIR = Path(__file__).resolve().parent
DEFAULT_ORIGINS = (
    'http://127.0.0.1:4173', 'http://localhost:4173',
    'http://127.0.0.1:3000', 'http://localhost:3000',
)


@dataclass(frozen=True)
class Settings:
    api_key: str | None = field(default=None, repr=False)
    model_id: str = 'deepseek-v4-flash'
    cors_origins: tuple[str, ...] = DEFAULT_ORIGINS

    @classmethod
    def from_env(cls):
        # Read the same local file at every start, without rewriting it or
        # mutating process variables. A saved value wins over an old terminal.
        saved = dotenv_values(AGENT_DIR / '.env', encoding='utf-8-sig')

        def value(name: str, default: str = '') -> str:
            local = saved.get(name)
            if local and local.strip():
                return local.strip()
            return os.getenv(name, default).strip()

        return cls(
            api_key=value('DEEPSEEK_API_KEY') or None,
            model_id=value('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
            cors_origins=tuple(o.strip() for o in value(
                'CORS_ALLOWED_ORIGINS', ','.join(DEFAULT_ORIGINS)).split(',') if o.strip()),
        )
