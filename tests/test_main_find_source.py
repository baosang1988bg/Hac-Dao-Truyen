import asyncio
from unittest.mock import patch

import pytest

import main as main_module


@pytest.fixture(autouse=True)
def restore_event_loop_after_test():
    """Không để asyncio.run() trong CLI làm mất loop của các test async cũ."""
    yield
    asyncio.set_event_loop(asyncio.new_event_loop())


def test_cmd_find_source_prints_best_and_import_hint(capsys):
    fake_result = {
        "best": {
            "source": "69shuba", "book_id": "43484",
            "url": "https://www.69shuba.com/book/43484",
            "valid": True, "chapter_count": 300,
            "title": "Phía trên tháp cao", "author": "Phong Phong Mang Mang",
        },
        "all": [{
            "source": "69shuba", "book_id": "43484",
            "url": "https://www.69shuba.com/book/43484",
            "valid": True, "chapter_count": 300,
            "title": "Phía trên tháp cao", "author": "Phong Phong Mang Mang",
        }],
    }

    async def _fake_find_source(query, max_results=15, author=""):
        return fake_result

    args = type("Args", (), {"query": "Phía trên tháp cao", "author": "Phong Phong Mang Mang"})()

    with patch("main.source_finder.find_source", side_effect=_fake_find_source):
        main_module.cmd_find_source(args)

    out = capsys.readouterr().out
    assert "https://www.69shuba.com/book/43484" in out
    assert "python main.py import --url https://www.69shuba.com/book/43484" in out


def test_cmd_find_source_exits_nonzero_when_nothing_found(capsys):
    async def _fake_find_source(query, max_results=15, author=""):
        return None

    args = type("Args", (), {"query": "truyen khong ton tai", "author": ""})()

    with patch("main.source_finder.find_source", side_effect=_fake_find_source):
        with pytest.raises(SystemExit) as exc_info:
            main_module.cmd_find_source(args)

    assert exc_info.value.code != 0
    assert "Không tìm thấy nguồn" in capsys.readouterr().out
