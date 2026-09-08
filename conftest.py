"""Repository tests always run against disposable data, including import-time SQLite."""
import os
import tempfile
from pathlib import Path

import pytest

_test_data = tempfile.TemporaryDirectory(prefix="hacdao-tests-")
os.environ["HACDAO_DATA_DIR"] = str(Path(_test_data.name) / "users")


@pytest.fixture(autouse=True)
def isolated_app(tmp_path, monkeypatch):
    import auth
    import novel_manager
    import security_utils
    import state
    import user_store
    from routers import novels, logs

    root = tmp_path / "novels"
    root.mkdir()
    monkeypatch.chdir(tmp_path)
    for module, attr in [(novel_manager, "NOVELS_BASE_DIR"),
                         (security_utils, "NOVELS_DIR"), (novels, "NOVELS_DIR"),
                         (logs, "NOVELS_DIR")]:
        monkeypatch.setattr(module, attr, str(root))
    monkeypatch.setattr(user_store, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(user_store, "DB_PATH", str(tmp_path / "users.db"))
    user_store._init_db()
    monkeypatch.setattr(auth, "ADMIN_PASSWORD", "test-admin-password")
    auth._sessions.clear()
    state.translation_tasks.clear()
    state.cancel_flags.clear()
    profile = novel_manager.create_novel("CI Demo", "", slug="ci-demo", glossary={"甲": "Giáp"})
    for number in (1, 2):
        (Path(profile.translated_dir) / f"Chương {number} - Mở đầu_VI.md").write_text(
            f"# Chương {number}: Mở đầu\n\n" + "Nội dung chương dùng riêng để kiểm thử. " * 4,
            encoding="utf-8")
    yield
    auth._sessions.clear()
    state.translation_tasks.clear()
    state.cancel_flags.clear()
