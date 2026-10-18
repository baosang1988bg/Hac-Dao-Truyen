"""Test cấu hình, ngân sách, adapter provider (không gọi mạng)."""
import json

import httpx
import pytest

from tools.swarm.budget import Budget, BudgetExceeded, cost_of
from tools.swarm.config import load_config, load_env_file
from tools.swarm.providers import (
    AllProvidersFailed, LLMResult, LLMRouter, ToolCall, _call_anthropic, _call_openai_compat, to_anthropic,
)


@pytest.fixture
def cfg():
    return load_config()


def test_config_has_all_roles_and_prices(cfg):
    assert set(cfg.roles) >= {"spec", "architect", "coder", "qa", "healer"}
    for role in cfg.roles.values():
        for ref in role.models:
            assert cfg.model(ref).output_per_mtok >= 0
    assert cfg.roles["spec"].models[0].startswith("google/")
    assert cfg.roles["qa"].models[0].startswith("xai/")
    assert cfg.roles["healer"].models[0].startswith("ollama/")


def test_public_view_has_no_secrets(cfg, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-SECRET")
    view = json.dumps(cfg.public_view())
    assert "SECRET" not in view
    assert '"has_key": true' in view


def test_load_env_file_does_not_override(tmp_path, monkeypatch):
    f = tmp_path / ".env.swarm"
    f.write_text('# c\nXAI_API_KEY="abc"\nexport GEMINI_API_KEY=g\n', encoding="utf-8")
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "keep")
    loaded = load_env_file(f)
    import os
    assert os.environ["XAI_API_KEY"] == "abc" and os.environ["GEMINI_API_KEY"] == "keep"
    assert loaded == ["XAI_API_KEY"]


def test_budget_blocks_before_overspend(cfg):
    m = cfg.model("anthropic/claude-sonnet-5-5")
    b = Budget(0.10)
    b.ensure(m, 10_000, 1_000)  # ~$0.045 OK
    b.charge("coder", m, 10_000, 1_000)
    with pytest.raises(BudgetExceeded):
        b.ensure(m, 10_000, 4_000)  # thêm ~$0.09 → vượt
    b.raise_limit(1)
    b.ensure(m, 10_000, 4_000)
    assert b.snapshot()["by_agent"]["coder"]["calls"] == 1
    assert cost_of(cfg.model("ollama/qwen2.5-coder:7b"), 10**6, 10**6) == 0


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_openai_compat_payload_and_tool_parsing(cfg):
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        seen["auth"] = req.headers.get("authorization")
        return httpx.Response(200, json={
            "choices": [{"finish_reason": "tool_calls", "message": {"content": None, "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "read_file", "arguments": '{"path": "a.js"}'}}]}}],
            "usage": {"prompt_tokens": 120, "completion_tokens": 7},
        })

    import os
    os.environ["OPENAI_API_KEY"] = "sk-test"
    prov = cfg.providers["openai"]
    res = _call_openai_compat(_client(handler), prov, "gpt-x", [{"role": "user", "content": "hi"}],
                              [{"type": "function", "function": {"name": "read_file", "parameters": {}}}], 0.2, 99)
    assert seen["url"].endswith("/v1/chat/completions")
    assert seen["body"]["max_completion_tokens"] == 99 and "temperature" not in seen["body"]
    assert seen["auth"] == "Bearer sk-test"
    assert res.tool_calls[0].name == "read_file" and res.tool_calls[0].arguments == {"path": "a.js"}
    assert (res.input_tokens, res.output_tokens) == (120, 7)


def test_ollama_has_no_auth_and_sends_temperature(cfg):
    seen = {}

    def handler(req):
        seen["body"] = json.loads(req.content)
        seen["auth"] = req.headers.get("authorization")
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    res = _call_openai_compat(_client(handler), cfg.providers["ollama"], "qwen", [{"role": "user", "content": "x"}],
                              None, 0.0, 10)
    assert seen["auth"] is None and seen["body"]["temperature"] == 0.0 and seen["body"]["max_tokens"] == 10
    assert res.text == "ok"


def test_anthropic_conversion_merges_tool_results():
    msgs = [
        {"role": "system", "content": "SYS"},
        {"role": "user", "content": "làm đi"},
        LLMResult(text="đọc 2 file", tool_calls=[ToolCall("t1", "read_file", {"path": "a"}),
                                                ToolCall("t2", "read_file", {"path": "b"})]).assistant_message(),
        {"role": "tool", "tool_call_id": "t1", "content": "A"},
        {"role": "tool", "tool_call_id": "t2", "content": "B"},
    ]
    system, out = to_anthropic(msgs)
    assert system == "SYS"
    assert [m["role"] for m in out] == ["user", "assistant", "user"]
    assert [b["type"] for b in out[1]["content"]] == ["text", "tool_use", "tool_use"]
    assert [b["tool_use_id"] for b in out[2]["content"]] == ["t1", "t2"]


def test_anthropic_call_parses_response(cfg, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    seen = {}

    def handler(req):
        seen["headers"] = req.headers
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={
            "content": [{"type": "text", "text": "xong"}, {"type": "tool_use", "id": "u1", "name": "finish",
                                                         "input": {"summary": "s"}}],
            "usage": {"input_tokens": 50, "output_tokens": 5}, "stop_reason": "tool_use"})

    res = _call_anthropic(_client(handler), cfg.providers["anthropic"], "claude-x",
                          [{"role": "system", "content": "S"}, {"role": "user", "content": "u"}],
                          [{"type": "function", "function": {"name": "finish", "parameters": {"type": "object"}}}],
                          0.1, 100)
    assert seen["headers"]["x-api-key"] == "k" and seen["headers"]["anthropic-version"]
    assert seen["body"]["system"] == "S" and seen["body"]["tools"][0]["input_schema"] == {"type": "object"}
    assert res.text == "xong" and res.tool_calls[0].arguments == {"summary": "s"} and res.input_tokens == 50


def test_router_falls_back_when_key_missing_or_http_error(cfg, monkeypatch):
    for k in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("XAI_API_KEY", "x")
    monkeypatch.setenv("OPENAI_API_KEY", "o")
    calls = []

    def handler(req):
        calls.append(req.url.host)
        if req.url.host == "api.x.ai":
            return httpx.Response(401, json={"error": "bad key"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "pass"}}],
                                         "usage": {"prompt_tokens": 10, "completion_tokens": 2}})

    events = []
    router = LLMRouter(cfg, Budget(1), lambda t, **k: events.append((t, k)), client=_client(handler))
    res = router.complete("qa", [{"role": "user", "content": "x"}])
    assert res.model_ref.startswith("openai/") and calls == ["api.x.ai", "api.openai.com"]
    assert any(t == "llm_call" for t, _ in events)
    # spec: cả Gemini lẫn Anthropic đều thiếu key → lỗi rõ ràng
    with pytest.raises(AllProvidersFailed):
        router.complete("spec", [{"role": "user", "content": "x"}])


def test_router_budget_exceeded_is_not_swallowed(cfg):
    router = LLMRouter(cfg, Budget(0.0001), lambda *a, **k: None,
                       fake=lambda *a: LLMResult(text="x"))
    with pytest.raises(BudgetExceeded):
        router.complete("coder", [{"role": "user", "content": "x" * 3000}])
