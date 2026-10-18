"""CLI: python -m tools.swarm {auto|serve|demo|run|check}."""
from __future__ import annotations

import argparse
import os
import secrets
import shutil
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import httpx

from tools.swarm.config import ROLE_ORDER, load_config, load_env_file
from tools.swarm.runs import RunManager
from tools.swarm.workspace import git

if hasattr(sys.stdout, "reconfigure"):  # Windows console: in được tiếng Việt
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def repo_root() -> Path:
    return Path(git(Path.cwd(), "rev-parse", "--show-toplevel").strip())


def _setup(args) -> tuple:
    root = repo_root()
    loaded = load_env_file(root / ".env.swarm")
    cfg = load_config(args.config)
    if args.budget:
        cfg.run.budget_usd = args.budget
    return root, cfg, loaded


def _free_port(start: int) -> int:
    for port in range(start, start + 20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit(f"Không tìm được cổng trống từ {start}")


def _serve(manager: RunManager, port: int, open_run: str | None, open_browser: bool) -> None:
    import uvicorn

    from tools.swarm.server import create_app

    port = _free_port(port)
    token = secrets.token_urlsafe(24)
    app = create_app(manager, token=token, port=port)
    url = f"http://127.0.0.1:{port}/#token={token}" + (f"&run={open_run}" if open_run else "")
    print(f"\n  Dashboard: {url}\n  (Ctrl+C để dừng server — run đang chạy dở sẽ bị huỷ)\n", flush=True)
    if open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


def cmd_serve(args) -> int:
    root, cfg, _ = _setup(args)
    _serve(RunManager(cfg, root), args.port, None, not args.no_open)
    return 0


def cmd_auto(args) -> int:
    root, cfg, loaded = _setup(args)
    request = " ".join(args.request).strip()
    if not request:
        print("Thiếu mô tả tính năng. Ví dụ: python -m tools.swarm auto \"Thêm nút chia sẻ chương\"")
        return 2
    missing = _missing_keys(cfg)
    if missing and not args.demo:
        print("⚠️  Thiếu key: " + ", ".join(missing) + " — các vai trò đó sẽ dùng model dự phòng.")
    manager = RunManager(cfg, root)
    run = manager.create(request, demo=args.demo)
    print(f"Run {run.id} — {'DEMO ' if args.demo else ''}ngân sách ${run.budget.limit:.2f}")
    _serve(manager, args.port, run.id, not args.no_open)
    return 0


def cmd_demo(args) -> int:
    args.demo = True
    if not args.request:
        args.request = ["Thêm nút chia sẻ chương lên Facebook/Zalo ở cuối trang đọc"]
    return cmd_auto(args)


def cmd_run(args) -> int:
    """Chế độ terminal (không dashboard): gate hỏi trực tiếp trong console."""
    root, cfg, _ = _setup(args)
    request = " ".join(args.request).strip()
    manager = RunManager(cfg, root)
    run = manager.create(request, demo=args.demo, auto_approve=args.yes)
    seq = 0
    while True:
        for ev in run.bus.wait_since(seq, 1.0):
            seq = ev["seq"]
            t = ev["type"]
            if t in ("log", "handoff"):
                who = ev.get("agent") or f"{ev.get('src')}→{ev.get('dst')}"
                print(f"[{who}] {ev.get('message', '')}", flush=True)
            elif t == "llm_call":
                print(f"   · {ev['model']} ${ev['cost']:.4f} (tổng ${ev['budget']['spent']:.3f})", flush=True)
            elif t == "artifact" and ev.get("path"):
                print(f"   📄 {ev['path']}")
            elif t == "gate_opened" and not args.yes:
                print(f"\n⏸  {ev['title']}\n{ev.get('message', '')}")
                wt = run.bus.state.get("worktree")
                for a in ev.get("artifacts", []):
                    print(f"   xem: {Path(wt) / 'specs' / run.bus.state.get('feature', '') / a}")
                ans = input("Duyệt? [y]es / [r]evise / [s]top: ").strip().lower()[:1]
                if ans == "r":
                    fb = input("Góp ý: ")
                    run.gates.resolve(ev["gate"], "revise", fb)
                elif ans == "s":
                    run.gates.resolve(ev["gate"], "stop")
                else:
                    fb = input("(gate ngân sách: số $ muốn tăng, Enter = 1): ") if ev["gate"] == "budget" else ""
                    run.gates.resolve(ev["gate"], "approve", fb)
            elif t == "run_finished":
                print(f"\n== {ev['status']} · nhánh {ev.get('branch')} · commit {ev.get('commit')}"
                      f" · ${ev['budget']['spent']:.3f}")
                for s in ev.get("next_steps") or []:
                    print("   " + s)
                return 0 if ev["status"] == "completed" else 1
        if not run.thread.is_alive() and seq >= run.bus.last_seq:
            return 1


def _missing_keys(cfg) -> list[str]:
    out = []
    for p in cfg.providers.values():
        if p.api_key_env and not p.has_key():
            out.append(f"{p.name} ({p.api_key_env})")
    return out


def cmd_check(args) -> int:
    root, cfg, loaded = _setup(args)
    ok = True
    print(f"Repo: {root}\nCấu hình: {cfg.source}\nNgân sách mặc định: ${cfg.run.budget_usd:.2f}")
    print(f".env.swarm: {'nạp ' + ', '.join(loaded) if loaded else 'không có / không nạp biến mới'}")
    for tool in ("git", "npm", "node"):
        found = shutil.which(tool)
        print(f"  {'✅' if found else '❌'} {tool}: {found or 'không có trong PATH'}")
        ok &= bool(found)
    print("Provider:")
    for p in cfg.providers.values():
        if p.name == "ollama" or not p.api_key_env:
            try:
                r = httpx.get(p.base_url.rstrip("/") + "/models", timeout=3)
                names = [m.get("id") for m in r.json().get("data", [])]
                print(f"  ✅ {p.name}: {p.base_url} ({len(names)} model: {', '.join(names[:6])})")
            except Exception as e:  # noqa: BLE001
                print(f"  ⚠️  {p.name}: không kết nối được {p.base_url} ({e.__class__.__name__}) — sẽ dùng model dự phòng")
        else:
            print(f"  {'✅' if p.has_key() else '⚠️ '} {p.name}: {p.api_key_env} {'đã đặt' if p.has_key() else 'CHƯA đặt'}")
    print("Vai trò:")
    for role in ROLE_ORDER:
        rc = cfg.roles[role]
        print(f"  {rc.title:<15} " + " → ".join(rc.models))
    if args.ping:
        from tools.swarm.budget import Budget
        from tools.swarm.providers import LLMRouter
        print("Ping model chính của từng vai trò (tốn vài phần trăm cent):")
        budget = Budget(0.05)
        router = LLMRouter(cfg, budget, lambda *a, **k: None)
        for role in ROLE_ORDER:
            rc = cfg.roles[role]
            saved = rc.models, rc.max_output_tokens
            rc.models, rc.max_output_tokens = rc.models[:1], 16
            try:
                t0 = time.monotonic()
                res = router.complete(role, [{"role": "user", "content": "Trả lời đúng một chữ: OK"}])
                print(f"  ✅ {rc.models[0]}: {res.text.strip()[:30]!r} ({time.monotonic() - t0:.1f}s)")
            except Exception as e:  # noqa: BLE001
                ok = False
                print(f"  ❌ {rc.models[0]}: {str(e)[:200]}")
            finally:
                rc.models, rc.max_output_tokens = saved
        print(f"Chi phí ping: ${budget.spent:.5f}")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m tools.swarm", description="Multi-Provider Agent Swarm (/speckit-auto)")
    ap.add_argument("--config", default=None, help="Đường dẫn agents.toml khác")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, request=True):
        if request:
            p.add_argument("request", nargs="*", help="Mô tả tính năng (tiếng Việt)")
        p.add_argument("--budget", type=float, default=None, help="Ngân sách USD cho run (mặc định theo agents.toml)")
        p.add_argument("--port", type=int, default=int(os.environ.get("SWARM_PORT", 8765)))
        p.add_argument("--no-open", action="store_true", help="Không tự mở trình duyệt")
        p.add_argument("--demo", action="store_true", help="Provider giả lập, không tốn tiền")

    p = sub.add_parser("auto", help="Tạo run + mở dashboard (lệnh của /speckit-auto)")
    common(p)
    p.set_defaults(fn=cmd_auto)
    p = sub.add_parser("serve", help="Chỉ mở dashboard; tạo run từ giao diện")
    common(p, request=False)
    p.set_defaults(fn=cmd_serve)
    p = sub.add_parser("demo", help="Chạy thử toàn bộ quy trình bằng provider giả lập")
    common(p)
    p.set_defaults(fn=cmd_demo)
    p = sub.add_parser("run", help="Chạy trong terminal, duyệt gate bằng bàn phím")
    common(p)
    p.add_argument("--yes", action="store_true", help="Tự duyệt mọi gate (chỉ nên dùng với --demo)")
    p.set_defaults(fn=cmd_run)
    p = sub.add_parser("check", help="Kiểm tra key, Ollama, git/npm, cấu hình")
    p.add_argument("--ping", action="store_true", help="Gọi thử model chính của từng vai trò")
    p.add_argument("--budget", type=float, default=None)
    p.set_defaults(fn=cmd_check)

    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except KeyboardInterrupt:
        print("\nĐã dừng.")
        return 130
