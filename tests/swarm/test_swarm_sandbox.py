"""Rào chắn của công cụ agent: đường dẫn, secret, vùng cấm ghi, env đã lọc."""
import pytest

from tools.swarm.context import pack_context, repo_map
from tools.swarm.sandbox import Sandbox, sanitized_env
from tools.swarm.workspace import next_feature_number, slugify


@pytest.fixture
def sb(tmp_repo):
    return Sandbox(tmp_repo)


@pytest.mark.parametrize("path", ["../outside.txt", "/etc/passwd", ".git/config", ".env", "frontend/.env.local",
                                  "credentials.json", "tools/key_status.json", ".env.swarm", ".ENV", ".GIT/config"])
def test_read_blocked(sb, path):
    assert sb.execute("read_file", {"path": path}).startswith("BỊ CHẶN")


@pytest.mark.parametrize("path", ["tools/swarm/pipeline.py", ".github/workflows/ci.yml", ".openhands/hooks.json",
                                  "wrangler.jsonc", "deploy.bat", "TOOLS/Swarm/x.py", "Wrangler.JSONC"])
def test_write_blocked(sb, path):
    assert sb.execute("write_file", {"path": path, "content": "x"}).startswith("BỊ CHẶN")


def test_env_example_readable(sb, tmp_repo):
    (tmp_repo / ".env.example").write_text("A=\n", encoding="utf-8")
    assert "A=" in sb.execute("read_file", {"path": ".env.example"})


def test_write_edit_read_roundtrip(sb):
    assert sb.execute("write_file", {"path": "frontend/src/x.js", "content": "a\nb\na\n"}).startswith("Đã ghi")
    assert "xuất hiện 2 lần" in sb.execute("edit_file", {"path": "frontend/src/x.js", "old_string": "a", "new_string": "c"})
    assert sb.execute("edit_file", {"path": "frontend/src/x.js", "old_string": "b", "new_string": "B"}).startswith("Đã sửa")
    assert "B" in sb.execute("read_file", {"path": "frontend/src/x.js"})
    assert "frontend/src/x.js" in sb.changed


def test_list_and_search_hide_secrets(sb):
    listing = sb.execute("list_files", {})
    assert "App.jsx" in listing and ".env" not in listing.split()
    assert "App.jsx" in sb.execute("search", {"pattern": "export default"})
    assert sb.execute("search", {"pattern": "CLOUDFLARE_API_TOKEN"}) == "(không tìm thấy)"


def test_unknown_tool_and_check(sb):
    assert sb.execute("shell", {"cmd": "npm run deploy"}).startswith("LỖI")
    assert "không tồn tại" in sb.execute("run_check", {"name": "deploy"})


def test_sanitized_env_strips_keys(tmp_path, monkeypatch):
    for k in ("ANTHROPIC_API_KEY", "CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN", "HACDAO_R2_WRITE_BUDGET"):
        monkeypatch.setenv(k, "secret")
    env = sanitized_env(tmp_path)
    assert not any(v == "secret" for v in env.values())
    assert env["HOME"] == str(tmp_path) and env["APPDATA"] == str(tmp_path) and env["CI"] == "1"


def test_context_packing_respects_budget_and_skips_secrets(sb):
    ctx, used = pack_context(sb, "App component", 2000)
    assert "AGENTS.md" in used and ".env" not in used
    assert len(ctx) <= 2000 * 3
    assert "frontend/src/App.jsx" in repo_map(sb)


def test_slugify_vietnamese_and_numbering(tmp_repo):
    assert slugify("Thêm nút chia sẻ chương lên Zalo/Facebook!", 60) == "them-nut-chia-se-chuong-len-zalo-facebook"
    assert len(slugify("x" * 100)) == 40
    assert slugify("Đổi màu") == "doi-mau"
    (tmp_repo / "specs/007-x").mkdir(parents=True)
    assert next_feature_number(tmp_repo) == 8
