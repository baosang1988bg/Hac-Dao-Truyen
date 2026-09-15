from unittest.mock import patch, MagicMock

import discover


def test_interactive_search_prints_real_url_when_found(capsys, monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _: "Phía trên tháp cao")

    async def _fake_find_source(query, max_results=15):
        return {
            "best": {
                "source": "69shuba", "book_id": "1", "url": "https://www.69shuba.com/book/1",
                "valid": True, "chapter_count": 300, "title": "T", "author": "A",
            },
            "all": [],
        }

    fake_client, fake_model = MagicMock(), "gemini-3-flash-preview"

    with patch("discover.source_finder.find_source", side_effect=_fake_find_source):
        with patch("discover.ask_gemini") as mocked_ask_gemini:
            discover.interactive_search(fake_client, fake_model)

    out = capsys.readouterr().out
    assert "https://www.69shuba.com/book/1" in out
    assert "300" in out
    mocked_ask_gemini.assert_not_called()


def test_interactive_search_falls_back_to_gemini_when_nothing_found(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _: "truyen khong ton tai abc")

    async def _fake_find_source(query, max_results=15):
        return None

    fake_client, fake_model = MagicMock(), "gemini-3-flash-preview"

    with patch("discover.source_finder.find_source", side_effect=_fake_find_source):
        with patch("discover.ask_gemini", return_value="[gợi ý Gemini]") as mocked_ask_gemini:
            discover.interactive_search(fake_client, fake_model)

    mocked_ask_gemini.assert_called_once()
