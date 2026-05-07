"""
demo_5chap.py
=============
Demo: Scrape 5 chương từ 69shuba theo link 下一章, dịch bằng Gemini.
Cách chạy: python3 demo_5chap.py
"""
import asyncio, os, re, time, glob
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
from google import genai

# ── Config ────────────────────────────────────────────────────────────────────
START_URL    = "https://www.69shuba.com/txt/51265/33481937"
NUM_CHAPTERS = 5
OUTPUT_DIR   = "novels/demo-51265"
RAW_DIR      = f"{OUTPUT_DIR}/text_raw"
VI_DIR       = f"{OUTPUT_DIR}/text_vi"
DELAY        = 3   # giây giữa các trang

os.makedirs(RAW_DIR, exist_ok=True)
os.makedirs(VI_DIR,  exist_ok=True)

# ── Gemini với model rotation ─────────────────────────────────────────────────
api_keys = [k.strip() for k in os.getenv("GOOGLE_API_KEYS", "").split(",") if k.strip()]
client   = genai.Client(api_key=api_keys[0])

# Pool các model sẽ rotate khi bị 429 (theo thứ tự ưu tiên)
MODEL_POOL = [
    m.strip()
    for m in os.getenv(
        "GEMINI_FALLBACK_MODELS",
        "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite-preview"
    ).split(",")
    if m.strip()
]
_model_idx = [0]  # dùng list để có thể mutate trong closure

def translate(text: str) -> str:
    prompt = f"""Dịch nội dung tiểu thuyết Trung Quốc sau sang tiếng Việt.
Yêu cầu:
- Văn phong tự nhiên, văn học, dễ đọc
- Tên nhân vật: phiên âm Hán-Việt (ví dụ: 陈明 → Trần Minh, 苏凌 → Tô Lăng)
- Thuật ngữ võ thuật/tu tiên: giữ Hán-Việt (Kinh Mạch, Đan Điền, Thiên Đạo...)
- KHÔNG để sót chữ Hán nào trong bản dịch
- Chỉ trả về bản dịch, không giải thích thêm

Nội dung:
{text}"""

    # Thử lần lượt từng model trong pool cho đến khi thành công
    tried = 0
    while tried < len(MODEL_POOL):
        model = MODEL_POOL[_model_idx[0] % len(MODEL_POOL)]
        try:
            resp = client.models.generate_content(model=model, contents=prompt)
            return resp.text.strip()
        except Exception as e:
            err = str(e)
            if "429" in err or "quota" in err.lower():
                print(f"    ⚠ [{model}] quota hit → thử model khác...")
                _model_idx[0] += 1
                tried += 1
            else:
                raise
    raise RuntimeError(f"Tất cả {len(MODEL_POOL)} model đều hết quota hôm nay.")


# ── Scraper ───────────────────────────────────────────────────────────────────

def get_next_url(soup: BeautifulSoup) -> str | None:
    """Lấy URL chương tiếp theo từ link 下一章."""
    for a in soup.find_all("a"):
        txt = a.get_text(strip=True)
        if "下一章" in txt:
            href = a.get("href", "")
            if not href:
                continue
            if href.startswith("http"):
                return href
            if href.startswith("/"):
                return "https://www.69shuba.com" + href
    return None

def parse_chapter(soup: BeautifulSoup) -> tuple[str, str, str | None]:
    """Trả về (title, content, next_url)."""
    # Title
    t = soup.select_one("h1, .title69, .booktitle, .readtitle")
    title = t.get_text(strip=True) if t else "Untitled"

    # Content
    c = soup.select_one(".txtnav, #contentbox, .contentbox, #content, .readcontent")
    if c:
        for tag in c.find_all(["script", "style", "ins", "noscript"]):
            tag.decompose()
        noise = re.compile(r"请收藏|请记住|最新章节|手机版|返回书架|加入书架|推荐票|月票|打赏|69shuba|69书吧|www\.\S+\.com")
        lines = c.get_text(separator="\n").split("\n")
        content = "\n".join(l.strip() for l in lines if l.strip() and not noise.search(l))
    else:
        content = "(Content not found)"

    next_url = get_next_url(soup)
    return title, content, next_url


async def fetch(url: str) -> BeautifulSoup:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            extra_http_headers={
                "Accept-Language": "zh-CN,zh;q=0.9",
                "Referer": "https://www.69shuba.com/",
            },
        )
        page = await ctx.new_page()
        await page.goto(url, wait_until="load", timeout=60000)
        await asyncio.sleep(2)
        html = await page.content()
        await browser.close()
    return BeautifulSoup(html, "html.parser")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    url = START_URL
    print(f"\n{'═'*60}")
    print(f"  DEMO: Scrape + Dịch {NUM_CHAPTERS} chương — Novel 51265")
    print(f"  Model: {model}")
    print(f"{'═'*60}\n")

    for i in range(1, NUM_CHAPTERS + 1):
        print(f"\n[{i}/{NUM_CHAPTERS}] ─────────────────────────────────────")
        print(f"  URL: {url}")

        soup = await fetch(url)
        title, content, next_url = parse_chapter(soup)

        print(f"  Tiêu đề   : {title}")
        print(f"  Nội dung  : {len(content)} ký tự")
        print(f"  Chương tiếp: {next_url or '(không tìm thấy)'}")

        # Lưu raw
        raw_file = f"{RAW_DIR}/{i:02d}_{title[:40]}.txt"
        with open(raw_file, "w", encoding="utf-8") as f:
            f.write(f"URL: {url}\nTiêu đề: {title}\n\n{content}")
        print(f"  ✓ Raw → {raw_file}")

        # Dịch
        print(f"  🔄 Dịch bằng Gemini...")
        t0 = time.time()
        try:
            translation = translate(content[:6000])
            elapsed = time.time() - t0
            print(f"  ✓ Dịch xong ({elapsed:.1f}s)")

            vi_file = f"{VI_DIR}/{i:02d}_{title[:40]}.txt"
            with open(vi_file, "w", encoding="utf-8") as f:
                f.write(f"URL: {url}\nTiêu đề: {title}\n\n{translation}")
            print(f"  ✓ Dịch → {vi_file}")
        except Exception as e:
            print(f"  ✗ Lỗi: {e}")
            translation = ""

        # Preview bản dịch
        if translation:
            preview = translation[:200].replace("\n", " ")
            print(f"\n  📖 Preview: {preview}…")

        if not next_url:
            print(f"\n  ⚠ Không tìm thấy link 下一章. Dừng.")
            break

        url = next_url
        if i < NUM_CHAPTERS:
            print(f"\n  ⏳ Chờ {DELAY}s...")
            await asyncio.sleep(DELAY)

    # Summary
    print(f"\n\n{'═'*60}")
    print(f"  ✅ Hoàn thành! Kết quả tại: {OUTPUT_DIR}/")
    print(f"{'═'*60}")
    print(f"\n  text_raw/  — {len(glob.glob(RAW_DIR+'/*.txt'))} file tiếng Trung")
    print(f"  text_vi/   — {len(glob.glob(VI_DIR+'/*.txt'))} file tiếng Việt\n")


if __name__ == "__main__":
    asyncio.run(main())
