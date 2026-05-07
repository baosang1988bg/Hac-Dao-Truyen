"""
check_keys.py
-------------
Kiểm tra trạng thái tất cả Gemini API key trong .env.
Tự động cập nhật key_status.json.

Cách dùng:
    python check_keys.py           # kiểm tra tất cả key
    python check_keys.py --reset   # reset tất cả key về "working" (dùng sau 24h)
    python check_keys.py --show    # chỉ hiển thị status hiện tại, không test
"""

import os
import sys
import time
import json
import argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

KEY_STATUS_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "key_status.json")
QUOTA_RESET_HOURS = 24
TEST_PROMPT = "Reply with only: OK"   # prompt ngắn nhất có thể để tiết kiệm quota

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_status() -> dict:
    if os.path.exists(KEY_STATUS_FILE):
        try:
            with open(KEY_STATUS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_status(status: dict):
    with open(KEY_STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hours_since(iso_ts: str) -> float:
    try:
        t = datetime.fromisoformat(iso_ts)
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() / 3600
    except Exception:
        return 999.0


def fmt_key(key: str) -> str:
    return f"...{key.strip()[-10:]}"


def classify_error(err: str) -> str:
    err_lower = err.lower()
    if any(p in err_lower for p in ("400", "401", "403", "invalid api key",
                                     "api key not valid", "permission denied",
                                     "api_key_invalid")):
        return "invalid"
    if any(p in err_lower for p in ("429", "quota", "resource_exhausted",
                                     "rate_limit", "perday", "per_day")):
        return "quota_exceeded"
    return "error"


# ── Test một key ──────────────────────────────────────────────────────────────

def test_key(key: str, model: str = "gemini-2.0-flash") -> tuple[str, str]:
    """
    Gọi Gemini API với key này.
    Returns: (status, note)
      status: "working" | "quota_exceeded" | "invalid" | "error"
    """
    try:
        from google import genai
        client = genai.Client(api_key=key.strip())
        resp = client.models.generate_content(
            model=model,
            contents=TEST_PROMPT,
        )
        # Thành công
        preview = (resp.text or "").strip()[:30]
        return "working", f'response: "{preview}"'
    except Exception as e:
        err = str(e)
        status = classify_error(err)
        # Lấy message ngắn gọn
        note = err.split("\n")[0][:120]
        return status, note


# ── Main ──────────────────────────────────────────────────────────────────────

def cmd_show(keys: list, status: dict):
    """Hiển thị status hiện tại mà không test."""
    print(f"\n{'─'*65}")
    print(f"  {'KEY':>14}  {'STATUS':<16}  {'SINCE':<20}  NOTE")
    print(f"{'─'*65}")
    for key in keys:
        key = key.strip()
        info  = status.get(key, {})
        st    = info.get("status", "unknown")
        since = info.get("since", "—")[:19].replace("T", " ")
        note  = info.get("note", "not tested yet")[:35]
        icon  = {"working": "✅", "quota_exceeded": "⏳", "invalid": "❌"}.get(st, "❓")
        hrs   = f"({hours_since(info['since']):.0f}h ago)" if info.get("since") else ""
        print(f"  {fmt_key(key):>14}  {icon} {st:<14}  {since} {hrs:<8}  {note}")
    print(f"{'─'*65}\n")


def cmd_reset(keys: list, status: dict):
    """Reset tất cả key về working."""
    for key in keys:
        key = key.strip()
        if status.get(key, {}).get("status") != "invalid":
            status[key] = {"status": "working", "since": now_iso(),
                           "note": "manual reset", "suffix": fmt_key(key)}
    save_status(status)
    print(f"✅ Reset {len(keys)} key(s) về 'working' (giữ nguyên key 'invalid')")
    cmd_show(keys, status)


def cmd_test(keys: list, status: dict):
    """Test từng key và cập nhật status."""
    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    # Dùng model nhẹ để test (không tốn quota nhiều)
    test_model = "gemini-2.0-flash"

    print(f"\n{'═'*65}")
    print(f"  🔑  GEMINI KEY CHECKER  —  {len(keys)} keys")
    print(f"  Test model: {test_model}")
    print(f"{'═'*65}\n")

    results = {"working": [], "quota_exceeded": [], "invalid": [], "error": []}

    for i, key in enumerate(keys, 1):
        key = key.strip()
        if not key:
            continue

        # Nếu đã biết là invalid → bỏ qua, không test lại
        current = status.get(key, {}).get("status", "unknown")
        if current == "invalid":
            print(f"  [{i}/{len(keys)}] {fmt_key(key):>14}  ⛔ SKIP (already invalid)")
            results["invalid"].append(key)
            continue

        # Nếu quota_exceeded và chưa đủ 24h → bỏ qua
        if current == "quota_exceeded":
            hrs = hours_since(status[key].get("since", ""))
            if hrs < QUOTA_RESET_HOURS:
                remaining = QUOTA_RESET_HOURS - hrs
                print(f"  [{i}/{len(keys)}] {fmt_key(key):>14}  ⏳ SKIP quota (resets in {remaining:.1f}h)")
                results["quota_exceeded"].append(key)
                continue

        print(f"  [{i}/{len(keys)}] {fmt_key(key):>14}  Testing...", end="", flush=True)
        t0 = time.time()
        st, note = test_key(key, test_model)
        ms = int((time.time() - t0) * 1000)

        icon = {"working": "✅", "quota_exceeded": "⏳", "invalid": "❌"}.get(st, "⚠️")
        print(f"\r  [{i}/{len(keys)}] {fmt_key(key):>14}  {icon} {st:<16}  {ms}ms  {note[:50]}")

        status[key] = {
            "status": st,
            "since":  now_iso(),
            "note":   note,
            "suffix": fmt_key(key),
        }
        results[st].append(key)
        save_status(status)

        # Delay nhỏ để tránh hit rate limit khi test nhiều key
        if i < len(keys):
            time.sleep(1.5)

    # ── Summary ──
    print(f"\n{'─'*65}")
    print(f"  ✅ Working       : {len(results['working'])} key(s)")
    print(f"  ⏳ Quota exceeded: {len(results['quota_exceeded'])} key(s)  (auto-recover sau 24h)")
    print(f"  ❌ Invalid       : {len(results['invalid'])} key(s)  (sai key / bị thu hồi)")
    if results["error"]:
        print(f"  ⚠️  Other error   : {len(results['error'])} key(s)")
    print(f"{'─'*65}")

    if results["invalid"]:
        print(f"\n  💡 Key invalid: xóa khỏi GOOGLE_API_KEYS trong .env")
        for k in results["invalid"]:
            print(f"     {fmt_key(k)}")

    if results["quota_exceeded"]:
        print(f"\n  💡 Key quota_exceeded: tự recover sau 24h, hoặc chạy --reset")

    total_working = len(results["working"])
    print(f"\n  📊 Có thể dịch: ~{total_working * 1500} chapters/ngày ({total_working} keys × 1500 req)")
    print()

    return results


def main():
    parser = argparse.ArgumentParser(
        description="🔑 Kiểm tra trạng thái Gemini API keys",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument("--reset", action="store_true",
                        help="Reset tất cả key về 'working' (dùng sau 24h quota reset)")
    parser.add_argument("--show",  action="store_true",
                        help="Chỉ hiển thị status hiện tại, không test API")
    args = parser.parse_args()

    raw = os.getenv("GOOGLE_API_KEYS", "") or os.getenv("GOOGLE_API_KEY", "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]

    if not keys:
        print("❌ Không tìm thấy GOOGLE_API_KEYS trong .env")
        sys.exit(1)

    status = load_status()

    if args.show:
        cmd_show(keys, status)
    elif args.reset:
        cmd_reset(keys, status)
    else:
        cmd_test(keys, status)


if __name__ == "__main__":
    main()
