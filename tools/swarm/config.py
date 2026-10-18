"""Đọc agents.toml + nạp API key từ .env.swarm (KHÔNG đọc .env production)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:  # Python 3.11+
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10
    import tomli as tomllib  # type: ignore

SWARM_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = SWARM_DIR / "agents.toml"
ROLE_ORDER = ("spec", "architect", "coder", "qa", "healer")


@dataclass
class ProviderCfg:
    name: str
    kind: str
    base_url: str
    api_key_env: str = ""
    max_tokens_field: str = "max_tokens"
    send_temperature: bool = True

    def api_key(self) -> str | None:
        if not self.api_key_env:
            return None
        return os.environ.get(self.api_key_env) or None

    def has_key(self) -> bool:
        return not self.api_key_env or bool(self.api_key())


@dataclass
class ModelCfg:
    ref: str                     # "provider/model"
    input_per_mtok: float
    output_per_mtok: float
    context_tokens: int = 128000

    @property
    def provider(self) -> str:
        return self.ref.split("/", 1)[0]

    @property
    def model(self) -> str:
        return self.ref.split("/", 1)[1]


@dataclass
class RoleCfg:
    name: str
    title: str
    models: list[str]
    temperature: float = 0.2
    max_output_tokens: int = 4000
    context_budget_tokens: int = 0


@dataclass
class RunCfg:
    budget_usd: float = 2.0
    worktree_root: str = "../HacDaoTruyen-swarm"
    branch_prefix: str = "feature/"
    max_coder_steps: int = 40
    max_qa_rounds: int = 2
    max_fix_rounds: int = 2
    max_revisions: int = 3
    http_timeout_s: float = 300


@dataclass
class SwarmConfig:
    run: RunCfg
    providers: dict[str, ProviderCfg]
    models: dict[str, ModelCfg]
    roles: dict[str, RoleCfg]
    source: Path | None = None
    warnings: list[str] = field(default_factory=list)

    def model(self, ref: str) -> ModelCfg:
        if ref not in self.models:
            raise KeyError(f"Model '{ref}' chưa khai báo giá trong [models] của agents.toml")
        return self.models[ref]

    def provider_for(self, ref: str) -> ProviderCfg:
        name = ref.split("/", 1)[0]
        if name not in self.providers:
            raise KeyError(f"Provider '{name}' (của model '{ref}') chưa khai báo trong [providers]")
        return self.providers[name]

    def public_view(self) -> dict:
        """Dữ liệu cho dashboard — KHÔNG chứa key."""
        return {
            "budget_usd": self.run.budget_usd,
            "roles": {
                n: {
                    "title": r.title,
                    "models": [
                        {
                            "ref": m,
                            "provider": m.split("/", 1)[0],
                            "has_key": self.provider_for(m).has_key(),
                        }
                        for m in r.models
                    ],
                }
                for n, r in self.roles.items()
            },
            "warnings": self.warnings,
        }


def load_config(path: Path | str | None = None) -> SwarmConfig:
    path = Path(path) if path else DEFAULT_CONFIG
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    run = RunCfg(**data.get("run", {}))
    providers = {
        n: ProviderCfg(name=n, **v) for n, v in data.get("providers", {}).items()
    }
    models = {ref: ModelCfg(ref=ref, **v) for ref, v in data.get("models", {}).items()}
    roles = {n: RoleCfg(name=n, **v) for n, v in data.get("roles", {}).items()}
    cfg = SwarmConfig(run=run, providers=providers, models=models, roles=roles, source=path)
    for role in ROLE_ORDER:
        if role not in roles:
            raise ValueError(f"agents.toml thiếu [roles.{role}]")
        for ref in roles[role].models:
            cfg.model(ref)
            cfg.provider_for(ref)
    return cfg


def load_env_file(path: Path) -> list[str]:
    """Nạp KEY=VALUE từ file (vd .env.swarm) vào os.environ nếu chưa có.

    Trả về danh sách tên biến đã nạp (không trả giá trị). Cố ý không dùng .env
    gốc của repo vì file đó chứa secret production (Cloudflare, D1, R2).
    """
    loaded: list[str] = []
    if not path.is_file():
        return loaded
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:]
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val
            loaded.append(key)
    return loaded
