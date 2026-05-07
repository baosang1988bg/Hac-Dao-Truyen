# 🔬 Research Notes — Google ADK

> Ghi chú kỹ thuật khi nghiên cứu ADK để tích hợp vào project

---

## ADK là gì (tóm tắt ngắn)

Google Agent Development Kit — framework Python chính thức của Google để build AI agents với Gemini. Hỗ trợ:
- `Agent` đơn giản (1 LLM + tools)
- `SequentialAgent` — chạy nhiều agent tuần tự, output của agent trước là input của agent sau
- `ParallelAgent` — chạy nhiều agent song song
- `LoopAgent` — lặp cho đến khi điều kiện thỏa mãn
- Built-in session management, memory, tool calling

## Cách ADK hoạt động với Gemini

ADK dùng `google-genai` SDK bên dưới — cùng thư viện project đang dùng. Không cần thêm API key mới, chỉ cần `GOOGLE_API_KEY` hoặc `GOOGLE_API_KEYS` như hiện tại.

```python
from google.adk.agents import Agent, SequentialAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
```

## Ví dụ SequentialAgent đơn giản

```python
from google.adk.agents import Agent, SequentialAgent

# Agent 1: Dịch thô
translator = Agent(
    name="translator",
    model="gemini-2.0-flash",
    instruction="Dịch đoạn văn tiếng Trung sang tiếng Việt. Ưu tiên tốc độ và độ chính xác.",
)

# Agent 2: Cải thiện văn phong
polisher = Agent(
    name="polisher",
    model="gemini-2.0-flash",
    instruction="Đọc bản dịch tiếng Việt và cải thiện văn phong tự nhiên hơn. KHÔNG thay đổi nội dung.",
)

# Orchestrator
pipeline = SequentialAgent(
    name="translation_pipeline",
    sub_agents=[translator, polisher],
)
```

## Cách wrap code Python hiện có vào ADK Tool

```python
from google.adk.tools import FunctionTool

def crawl_chapter(url: str) -> dict:
    """Crawl nội dung chương từ URL."""
    scraper = NovelScraper()
    # ... existing scraper logic
    return {"title": title, "content": content, "next_url": next_url}

scraper_tool = FunctionTool(func=crawl_chapter)

scraper_agent = Agent(
    name="scraper",
    model="gemini-2.0-flash",
    tools=[scraper_tool],
    instruction="Dùng tool crawl_chapter để lấy nội dung từ URL được cung cấp.",
)
```

## InMemorySessionService — state management

```python
from google.adk.sessions import InMemorySessionService
from google.adk.runners import Runner

session_service = InMemorySessionService()
runner = Runner(
    agent=pipeline,
    app_name="novel_translator",
    session_service=session_service,
)

# Chạy pipeline
async def run_pipeline(novel_slug: str, chapter_url: str):
    session = await session_service.create_session(
        app_name="novel_translator",
        user_id=novel_slug,
    )
    result = await runner.run_async(
        user_id=novel_slug,
        session_id=session.id,
        new_message=Content(parts=[Part(text=chapter_url)]),
    )
    return result
```

## Điểm khác biệt ADK vs code hiện tại

| Tính năng | Code hiện tại | Với ADK |
|---|---|---|
| Số lần gọi AI/chương | 1 | 1–3 (tùy config) |
| QC tự động | ❌ chạy tay | ✅ tự động |
| Pass 2 polish | ❌ | ✅ PolishAgent |
| Glossary tự học | Một phần | ✅ GlossaryAgent |
| Parallel chapters | ❌ | ✅ ParallelAgent |
| Debug/trace | Log file | ADK built-in trace |
| Complexity | Thấp | Trung bình |

## Vấn đề tiềm ẩn

**1. ADK không design cho batch processing**
ADK hướng đến conversational agents. Để dịch batch 40 chương, cần tự implement vòng lặp bên ngoài ADK, hoặc dùng `ParallelAgent` với nhiều session.

**2. Rate limiting với nhiều agents**
Mỗi agent gọi API độc lập → không share rate limit counter với `key_status.json` hiện tại. Cần custom tool để report key status về `NovelTranslator`.

**3. Context window**
SequentialAgent truyền toàn bộ conversation history giữa các agent → context phình to sau nhiều chương. Cần clear session sau mỗi chương.

**4. Cost tracking**
ADK không tự track token/cost theo format `[💰]` của project. Cần custom callback hoặc middleware.

## Quyết định thiết kế

- **Orchestrator nằm ngoài ADK**: vòng lặp chapter-by-chapter vẫn do `main.py` / `api.py` quản lý
- **ADK chỉ xử lý 1 chương tại một thời điểm**: `SequentialAgent` nhận raw text → output translated text
- **Session reset sau mỗi chương**: tránh context phình
- **Key rotation vẫn do `NovelTranslator` quản lý**: ADK chỉ gọi method của nó

---

*Cập nhật khi có thêm insight mới khi implement*
