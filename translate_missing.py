"""Dịch các chapter còn thiếu bản dịch trong novel demo-51265."""
import os, time, glob
from dotenv import load_dotenv
load_dotenv()
from google import genai

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEYS","").split(",")[0].strip())

MODEL_POOL = [
    m.strip() for m in
    os.getenv("GEMINI_FALLBACK_MODELS",
              "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite-preview"
    ).split(",")
    if m.strip()
]
_idx = [0]

def translate(text):
    prompt = f"""Dịch nội dung tiểu thuyết Trung Quốc sau sang tiếng Việt.
- Văn phong tự nhiên, văn học, dễ đọc
- Tên nhân vật: phiên âm Hán-Việt (陈明→Trần Minh, 苏凌→Tô Lăng...)
- Thuật ngữ tu tiên giữ Hán-Việt (Kinh Mạch, Đan Điền, Thiên Đạo...)
- KHÔNG để sót chữ Hán
- Chỉ trả về bản dịch

Nội dung:
{text}"""
    tried = 0
    while tried < len(MODEL_POOL):
        m = MODEL_POOL[_idx[0] % len(MODEL_POOL)]
        try:
            r = client.models.generate_content(model=m, contents=prompt)
            print(f"    ✓ model: {m}")
            return r.text.strip()
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower():
                print(f"    ⚠ [{m}] quota → thử model tiếp...")
                _idx[0] += 1
                tried += 1
            else:
                raise
    raise RuntimeError("Tất cả model đều hết quota.")

VI_DIR  = "novels/demo-51265/text_vi"
RAW_DIR = "novels/demo-51265/text_raw"
os.makedirs(VI_DIR, exist_ok=True)

raw_files = sorted(glob.glob(f"{RAW_DIR}/*.txt"))
vi_names  = {os.path.basename(f) for f in glob.glob(f"{VI_DIR}/*.txt")}

print(f"\n{'═'*55}")
print(f"  Dịch chapter còn thiếu — novel demo-51265")
print(f"  Model pool: {MODEL_POOL}")
print(f"{'═'*55}\n")

for raw in raw_files:
    name = os.path.basename(raw)
    if name in vi_names:
        print(f"  [skip] {name}")
        continue

    with open(raw, encoding="utf-8") as f:
        raw_text = f.read()
    parts = raw_text.split("\n", 3)
    url     = parts[0].replace("URL: ", "")
    title   = parts[1].replace("Tiêu đề: ", "")
    content = parts[3] if len(parts) > 3 else raw_text

    print(f"\n  [dịch] {name}")
    t0 = time.time()
    try:
        vi = translate(content[:6000])
        elapsed = time.time() - t0
        vi_path = f"{VI_DIR}/{name}"
        with open(vi_path, "w", encoding="utf-8") as f:
            f.write(f"URL: {url}\nTiêu đề: {title}\n\n{vi}")
        print(f"  ✓ {elapsed:.1f}s → {vi_path}")
        print(f"  Preview: {vi[:180].replace(chr(10), ' ')}…")
    except Exception as e:
        print(f"  ✗ Lỗi: {e}")

total = len(glob.glob(f"{VI_DIR}/*.txt"))
print(f"\n{'═'*55}")
print(f"  ✅ Hoàn thành — {total}/5 chương đã có bản dịch")
print(f"{'═'*55}\n")
