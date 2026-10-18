"""Theo dõi chi phí và chặn lời gọi vượt ngân sách."""
from __future__ import annotations

import threading

from tools.swarm.config import ModelCfg


class BudgetExceeded(Exception):
    def __init__(self, spent: float, limit: float, needed: float, model: str):
        self.spent, self.limit, self.needed, self.model = spent, limit, needed, model
        super().__init__(
            f"Lời gọi {model} dự kiến tốn ~${needed:.4f}; đã dùng ${spent:.4f}/${limit:.2f}"
        )


def cost_of(model: ModelCfg, input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens * model.input_per_mtok + output_tokens * model.output_per_mtok
    ) / 1_000_000


class Budget:
    def __init__(self, limit_usd: float):
        self.limit = float(limit_usd)
        self.spent = 0.0
        self.input_tokens = 0
        self.output_tokens = 0
        self.by_agent: dict[str, dict] = {}
        self._lock = threading.Lock()

    def ensure(self, model: ModelCfg, est_input_tokens: int, max_output_tokens: int) -> float:
        """Ước lượng trường hợp xấu (dùng hết max_output) — vượt thì raise."""
        est = cost_of(model, est_input_tokens, max_output_tokens)
        with self._lock:
            if est > 0 and self.spent + est > self.limit:
                raise BudgetExceeded(self.spent, self.limit, est, model.ref)
        return est

    def charge(self, agent: str, model: ModelCfg, input_tokens: int, output_tokens: int) -> float:
        c = cost_of(model, input_tokens, output_tokens)
        with self._lock:
            self.spent += c
            self.input_tokens += input_tokens
            self.output_tokens += output_tokens
            a = self.by_agent.setdefault(agent, {"cost": 0.0, "input_tokens": 0, "output_tokens": 0, "calls": 0})
            a["cost"] += c
            a["input_tokens"] += input_tokens
            a["output_tokens"] += output_tokens
            a["calls"] += 1
        return c

    def raise_limit(self, delta: float) -> None:
        with self._lock:
            self.limit += float(delta)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "limit": round(self.limit, 4),
                "spent": round(self.spent, 6),
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "by_agent": {k: dict(v) for k, v in self.by_agent.items()},
            }
