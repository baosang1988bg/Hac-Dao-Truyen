"""FastAPI server cho Live Dashboard: REST + Server-Sent Events.

Bảo vệ:
- Chỉ bind 127.0.0.1; kiểm tra Host header (chống DNS rebinding).
- Mọi API cần token ngẫu nhiên (header X-Swarm-Token, hoặc ?token= cho SSE) — trang web
  lạ mở trong trình duyệt không thể gọi POST tạo run tốn tiền (CSRF tới localhost).
"""
from __future__ import annotations

import asyncio
import json
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from tools.swarm.runs import RunManager

DASHBOARD = Path(__file__).resolve().parent / "dashboard" / "index.html"


class NewRun(BaseModel):
    request: str = Field(min_length=3, max_length=4000)
    budget_usd: float | None = Field(default=None, gt=0, le=50)
    base_ref: str = Field(default="HEAD", max_length=200, pattern=r"^[A-Za-z0-9._/\-^~]+$")
    demo: bool = False


class GateAnswer(BaseModel):
    decision: str = Field(pattern=r"^(approve|revise|stop)$")
    feedback: str = Field(default="", max_length=8000)


def create_app(manager: RunManager, token: str | None = None, port: int = 8765) -> FastAPI:
    token = token or secrets.token_urlsafe(24)
    app = FastAPI(title="HacDao Swarm", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.token = token
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}", "127.0.0.1", "localhost", "testserver"}

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.headers.get("host", "") not in allowed_hosts:
            return JSONResponse({"detail": "Host không hợp lệ"}, status_code=403)
        if request.url.path.startswith("/api/"):
            given = request.headers.get("x-swarm-token") or request.query_params.get("token")
            if not given or not secrets.compare_digest(given, token):
                return JSONResponse({"detail": "Thiếu hoặc sai token"}, status_code=401)
        resp = await call_next(request)
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        return resp

    def _run(run_id: str):
        run = manager.get(run_id)
        if not run:
            raise HTTPException(404, "Không có run này")
        return run

    @app.get("/", response_class=HTMLResponse)
    def index():
        html = DASHBOARD.read_text(encoding="utf-8")
        return HTMLResponse(html, headers={
            "Content-Security-Policy": (
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            ),
        })

    @app.get("/api/config")
    def config():
        return manager.cfg.public_view()

    @app.get("/api/runs")
    def runs():
        return manager.list()

    @app.post("/api/runs")
    def new_run(body: NewRun):
        try:
            run = manager.create(body.request, budget_usd=body.budget_usd, base_ref=body.base_ref, demo=body.demo)
        except (ValueError, RuntimeError) as e:
            raise HTTPException(409, str(e)) from e
        return {"id": run.id}

    @app.get("/api/runs/{run_id}")
    def run_state(run_id: str):
        run = _run(run_id)
        return {"state": run.bus.snapshot(), "pending_gates": run.gates.pending(), "last_seq": run.bus.last_seq}

    @app.post("/api/runs/{run_id}/gates/{gate}")
    def answer_gate(run_id: str, gate: str, body: GateAnswer):
        run = _run(run_id)
        if body.decision == "revise" and not body.feedback.strip():
            raise HTTPException(422, "Cần ghi góp ý khi yêu cầu sửa")
        if not run.gates.resolve(gate, body.decision, body.feedback):
            raise HTTPException(409, "Gate không ở trạng thái chờ")
        return {"ok": True}

    @app.post("/api/runs/{run_id}/cancel")
    def cancel(run_id: str):
        _run(run_id)
        manager.cancel(run_id)
        return {"ok": True}

    @app.get("/api/runs/{run_id}/events")
    async def events(run_id: str, request: Request, after: int = 0):
        run = _run(run_id)
        last = request.headers.get("last-event-id")
        seq = int(last) if last and last.isdigit() else max(0, after)

        async def stream():
            nonlocal seq
            yield "retry: 2000\n\n"
            while True:
                if await request.is_disconnected():
                    return
                evs = await asyncio.to_thread(run.bus.wait_since, seq, 15.0)
                if not evs:
                    yield ": ping\n\n"
                    continue
                for ev in evs:
                    seq = ev["seq"]
                    yield f"id: {seq}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
                if run.bus.state.get("result") and not run.thread.is_alive() and seq >= run.bus.last_seq:
                    yield "event: end\ndata: {}\n\n"
                    return

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"X-Accel-Buffering": "no"})

    return app
