from dotenv import load_dotenv; load_dotenv()
from google import genai
import os, time

keys = [k.strip() for k in os.getenv("GOOGLE_API_KEYS","").split(",") if k.strip()]
client = genai.Client(api_key=keys[0])

# Test tất cả models thực sự có sẵn trên account này
# Ưu tiên stable/production models (không preview)
PRIORITY_MODELS = [
    # Stable production models — thường có Pro limits
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash-lite-001",
    # Aliases
    "gemini-flash-latest",
    "gemini-pro-latest",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
    # Preview models
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-flash-lite-preview",
]

test_prompt = "Dịch sang tiếng Việt: 他走向远方的路上，心中充满了希望 (chỉ trả về bản dịch)"

print("=== Model Availability & Quality Test ===")
print(f"API Key: ...{keys[0][-8:]}\n")
print(f"{'Model':<40} {'Status':<12} {'Latency':<10} {'Output'}")
print("─"*100)

available = []
for model in PRIORITY_MODELS:
    try:
        t0 = time.time()
        resp = client.models.generate_content(
            model=model,
            contents=test_prompt,
            config={"max_output_tokens": 100}
        )
        ms = int((time.time()-t0)*1000)
        text = resp.text.strip()[:50] if resp.text else "(empty)"
        print(f"  ✅ {model:<38} {'OK':<12} {ms}ms       {text}")
        available.append(model)
    except Exception as e:
        err = str(e)
        if "429" in err:
            status = "QUOTA HIT"
        elif "404" in err or "not found" in err.lower():
            status = "NOT FOUND"
        else:
            status = f"ERR"
        print(f"  {'⚠' if 'QUOTA' in status else '❌'} {model:<38} {status:<12}")
    time.sleep(1.5)

print(f"\n{'─'*100}")
print(f"✅ Available models ({len(available)}):")
for m in available:
    print(f"   {m}")

if available:
    print(f"\n💡 Recommended rotation order:")
    # Prefer 2.5 flash as fastest, then pro for quality
    recommended = [m for m in ["gemini-2.5-flash","gemini-2.5-pro","gemini-2.0-flash","gemini-2.0-flash-001","gemini-flash-latest"] if m in available]
    for i, m in enumerate(recommended or available[:4], 1):
        print(f"   {i}. {m}")
