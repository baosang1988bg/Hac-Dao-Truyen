"""
tools/tts_pregen.py
-------------------
KHUNG sinh trước audio TTS theo chương (kế hoạch
plans/KE_HOACH_TTS_BANDICH_HANVIET_2026-11-26.md, mục A1 — học từ truyentrung
"TTS 2 tầng": audio neural phía server + fallback Web Speech phía client).

TRẠNG THÁI: CHỈ LÀ KHUNG.
  - KHÔNG sinh audio thật: EdgeTtsProvider / AzureSpeechProvider là stub ném
    NotImplementedError (edge-tts là endpoint không chính thức của Microsoft —
    cần quyết định ToS/chi phí trước khi bật).
  - KHÔNG ghi R2, KHÔNG gọi mạng, KHÔNG có bước CI.
  - Cờ môi trường HACDAO_TTS_ENABLED mặc định TẮT → script thoát sớm kèm
    thông báo (trừ --dry-run: chỉ đọc file local + in kế hoạch, luôn an toàn).

Phần THUẦN (có pytest ở tests/test_tts_pregen.py):
  - markdown_paragraphs(md): markdown chương → danh sách đoạn văn theo ĐÚNG thứ
    tự `.reader-p` mà Reader (ReactMarkdown) hiển thị (bỏ heading/hr/list), để
    chỉ số đoạn phía server khớp tô sáng + tiến độ đoạn phía client.
  - build_chunks(paragraphs): tách khúc ≤ 220 ký tự giữ chỉ số đoạn (cùng quy
    tắc frontend/src/utils/ttsQueue.js).
  - paragraph_marks(chunks, durations_ms): mốc thời gian (ms) từng đoạn từ
    thời lượng từng khúc → file .json đi kèm .mp3 để client tô sáng theo
    currentTime mà không phải ước lượng theo độ dài ký tự.
  - r2_keys(slug, voice, chapter): khoá R2 `<slug>/tts/<voice>/<chapter>.mp3|.json`.
  - estimate_bytes(chars): ước tính dung lượng MP3.

Ví dụ:
  python tools/tts_pregen.py --novel <slug> --chapters 1-20 --dry-run
  HACDAO_TTS_ENABLED=1 python tools/tts_pregen.py --novel <slug> --chapters 1   # hiện: báo chưa cài provider
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.normalize_chapters import chapter_num  # noqa: E402

NOVELS_DIR = os.path.join(ROOT, "novels")
CHUNK_MAX = 220
DEFAULT_VOICE = "vi-VN-HoaiMyNeural"
VOICES = ("vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural")
# edge-tts mặc định: MP3 24 kHz mono 48 kbps ≈ 6 KB/giây.
DEFAULT_BITRATE_KBPS = 48
# Tốc độ nói tiếng Việt ở rate 1.0 ≈ 15 ký tự/giây (kể cả khoảng trắng, dấu câu).
DEFAULT_CHARS_PER_SEC = 15.0
ENV_FLAG = "HACDAO_TTS_ENABLED"

EXIT_OK = 0
EXIT_DISABLED = 0  # tắt là trạng thái bình thường — không coi là lỗi
EXIT_NOT_FOUND = 1
EXIT_PROVIDER = 2

_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


# ── Cờ bật/tắt ───────────────────────────────────────────────────────────────

def is_enabled(env=None) -> bool:
    """HACDAO_TTS_ENABLED ∈ {1, true, yes, on} (không phân biệt hoa thường) → bật."""
    env = os.environ if env is None else env
    return str(env.get(ENV_FLAG, "")).strip().lower() in {"1", "true", "yes", "on"}


# ── Markdown → đoạn văn (khớp `.reader-p` của Reader) ────────────────────────

_HEADING = re.compile(r"^\s{0,3}#{1,6}(\s|$)")
_HR = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
_LIST = re.compile(r"^\s{0,3}([-*+]|\d{1,9}[.)])\s+")
_SETEXT = re.compile(r"^\s{0,3}(=+|-+)\s*$")
_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_EMPH = re.compile(r"(\*\*|__|\*|_|~~|`)")


def strip_inline(text: str) -> str:
    """Bỏ cú pháp inline (link, nhấn mạnh, code) — giữ chữ như textContent."""
    text = _LINK.sub(r"\1", text)
    text = _EMPH.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def markdown_paragraphs(md: str) -> list[str]:
    """
    Gần đúng cách ReactMarkdown tạo <p>: khối cách nhau bởi dòng trống; heading
    ATX (#), đường kẻ (---/***), dòng gạch setext và danh sách (tight list không
    sinh <p>) KHÔNG phải đoạn; blockquote (>) vẫn là đoạn. Giới hạn: không mô
    phỏng code block, bảng, HTML thô (chương truyện không dùng).
    """
    paras: list[str] = []
    buf: list[str] = []

    def flush():
        if buf:
            text = strip_inline(" ".join(buf))
            if text:
                paras.append(text)
            buf.clear()

    for raw in (md or "").replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        if not line.strip():
            flush()
            continue
        if buf and _SETEXT.match(line):
            # "Tiêu đề\n====" / "Tiêu đề\n---" (CommonMark: setext heading, ưu
            # tiên hơn đường kẻ) → heading, không phải đoạn.
            buf.clear()
            continue
        if _HEADING.match(line) or _HR.match(line) or _LIST.match(line):
            flush()
            continue
        buf.append(re.sub(r"^\s{0,3}>\s?", "", line))
    flush()
    return paras


# ── Tách khúc (cùng quy tắc frontend/src/utils/ttsQueue.js) ──────────────────

_SENTENCE = re.compile(r"[^.!?…。！？；;]+(?:[.!?…。！？；;]+[\"'”’»)\]]*|$)")
_CLAUSE = re.compile(r"[^,，:：、—–]+(?:[,，:：、—–]+|$)")


def _hard_split(text: str, max_chars: int) -> list[str]:
    out, cur = [], ""
    for word in text.split(" "):
        if not word:
            continue
        if len(word) > max_chars:
            if cur:
                out.append(cur)
                cur = ""
            out.extend(word[i:i + max_chars] for i in range(0, len(word), max_chars))
            continue
        nxt = f"{cur} {word}" if cur else word
        if len(nxt) > max_chars:
            out.append(cur)
            cur = word
        else:
            cur = nxt
    if cur:
        out.append(cur)
    return out


def split_paragraph(text: str, max_chars: int = CHUNK_MAX) -> list[str]:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        return []
    if len(clean) <= max_chars:
        return [clean]
    pieces: list[str] = []
    for m in _SENTENCE.finditer(clean):
        s = m.group(0).strip()
        if not s:
            continue
        if len(s) <= max_chars:
            pieces.append(s)
            continue
        for c in (x.group(0).strip() for x in _CLAUSE.finditer(s)):
            if not c:
                continue
            pieces.extend([c] if len(c) <= max_chars else _hard_split(c, max_chars))
    out, cur = [], ""
    for piece in pieces:
        nxt = f"{cur} {piece}" if cur else piece
        if len(nxt) <= max_chars:
            cur = nxt
            continue
        if cur:
            out.append(cur)
        cur = piece
    if cur:
        out.append(cur)
    return out


def build_chunks(paragraphs: list[str], max_chars: int = CHUNK_MAX) -> list[dict]:
    """Danh sách đoạn → [{p, text}] (p = chỉ số đoạn gốc, đoạn rỗng bị bỏ)."""
    return [{"p": p, "text": t} for p, para in enumerate(paragraphs or []) for t in split_paragraph(para, max_chars)]


# ── Mốc thời gian đoạn ───────────────────────────────────────────────────────

def paragraph_marks(chunks: list[dict], durations_ms: list[float]) -> list[dict]:
    """
    Thời lượng từng khúc (ms, theo thứ tự ghép vào MP3) → mốc từng ĐOẠN:
    [{p, start_ms, end_ms}] (các khúc liên tiếp cùng đoạn được gộp).
    """
    if len(chunks) != len(durations_ms):
        raise ValueError(f"số khúc ({len(chunks)}) khác số thời lượng ({len(durations_ms)})")
    marks: list[dict] = []
    t = 0.0
    for ch, dur in zip(chunks, durations_ms):
        d = float(dur)
        if d < 0 or d != d:  # âm hoặc NaN
            raise ValueError(f"thời lượng không hợp lệ: {dur!r}")
        start, t = t, t + d
        if marks and marks[-1]["p"] == ch["p"]:
            marks[-1]["end_ms"] = round(t)
        else:
            marks.append({"p": ch["p"], "start_ms": round(start), "end_ms": round(t)})
    return marks


def chapter_manifest(slug: str, chapter: int, voice: str, chunks: list[dict], durations_ms: list[float]) -> dict:
    """Nội dung file .json đi kèm .mp3 (client dùng để tô sáng theo currentTime)."""
    marks = paragraph_marks(chunks, durations_ms)
    return {
        "v": 1, "slug": slug, "chapter": chapter, "voice": voice,
        "duration_ms": marks[-1]["end_ms"] if marks else 0,
        "paragraphs": marks,
    }


# ── Khoá R2 + ước tính dung lượng ────────────────────────────────────────────

def _safe(segment: str, what: str) -> str:
    s = str(segment)
    if not _SAFE_SEGMENT.match(s) or ".." in s:
        raise ValueError(f"{what} không hợp lệ cho khoá R2: {segment!r}")
    return s


def r2_keys(slug: str, voice: str, chapter: int) -> tuple[str, str]:
    """(khoá .mp3, khoá .json) dạng `<slug>/tts/<voice>/<chapter>.mp3|.json`."""
    if isinstance(chapter, bool) or not isinstance(chapter, int) or chapter < 0:
        raise ValueError(f"số chương không hợp lệ: {chapter!r}")
    base = f"{_safe(slug, 'slug')}/tts/{_safe(voice, 'voice')}/{chapter}"
    return f"{base}.mp3", f"{base}.json"


def estimate_seconds(chars: int, chars_per_sec: float = DEFAULT_CHARS_PER_SEC) -> float:
    return max(0, chars) / chars_per_sec if chars_per_sec > 0 else 0.0


def estimate_bytes(chars: int, bitrate_kbps: int = DEFAULT_BITRATE_KBPS,
                   chars_per_sec: float = DEFAULT_CHARS_PER_SEC) -> int:
    """Ước tính dung lượng MP3 (byte) theo số ký tự đọc."""
    return int(estimate_seconds(chars, chars_per_sec) * bitrate_kbps * 1000 / 8)


def fmt_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


# ── Provider (STUB) ──────────────────────────────────────────────────────────

class TtsProvider:
    """Giao diện provider: synthesize(text, voice) → (mp3_bytes, duration_ms)."""

    name = "base"

    def synthesize(self, text: str, voice: str) -> tuple[bytes, float]:  # pragma: no cover - giao diện
        raise NotImplementedError


class EdgeTtsProvider(TtsProvider):
    name = "edge"

    def synthesize(self, text: str, voice: str) -> tuple[bytes, float]:
        raise NotImplementedError(
            "EdgeTtsProvider chưa được cài: edge-tts là endpoint KHÔNG chính thức của Microsoft "
            "(rủi ro bị chặn/ToS). Cần duyệt trước khi thêm phụ thuộc edge-tts và bật."
        )


class AzureSpeechProvider(TtsProvider):
    name = "azure"

    def synthesize(self, text: str, voice: str) -> tuple[bytes, float]:
        raise NotImplementedError(
            "AzureSpeechProvider chưa được cài: cần AZURE_SPEECH_KEY/REGION + duyệt chi phí "
            "(Azure Speech tính phí theo ký tự)."
        )


PROVIDERS = {"edge": EdgeTtsProvider, "azure": AzureSpeechProvider}


# ── Lập kế hoạch ─────────────────────────────────────────────────────────────

@dataclass
class ChapterPlan:
    chapter: int
    file: str
    paragraphs: int
    chunks: int
    chars: int
    est_seconds: float
    est_bytes: int
    mp3_key: str
    json_key: str
    chunk_list: list = field(default_factory=list, repr=False)


def parse_range(spec: str | None) -> tuple[int, int] | None:
    """'5' → (5, 5); '1-20' → (1, 20); None/'' → None (mọi chương)."""
    if not spec:
        return None
    m = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?", spec)
    if not m:
        raise ValueError(f"--chapters không hợp lệ: {spec!r} (dạng 5 hoặc 1-20)")
    a = int(m.group(1))
    b = int(m.group(2)) if m.group(2) else a
    if b < a:
        raise ValueError(f"--chapters ngược: {spec!r}")
    return a, b


def plan_chapter(slug: str, voice: str, chapter: int, md: str, file: str = "") -> ChapterPlan:
    paras = markdown_paragraphs(md)
    chunks = build_chunks(paras)
    chars = sum(len(c["text"]) for c in chunks)
    mp3_key, json_key = r2_keys(slug, voice, chapter)
    return ChapterPlan(
        chapter=chapter, file=file, paragraphs=len(paras), chunks=len(chunks), chars=chars,
        est_seconds=estimate_seconds(chars), est_bytes=estimate_bytes(chars),
        mp3_key=mp3_key, json_key=json_key, chunk_list=chunks,
    )


def plan_novel(slug: str, voice: str = DEFAULT_VOICE, chapters: tuple[int, int] | None = None,
               novels_dir: str = NOVELS_DIR) -> list[ChapterPlan]:
    """Đọc novels/<slug>/translated/*.md (chỉ đọc) → kế hoạch theo chương."""
    _safe(slug, "slug")
    tdir = os.path.join(novels_dir, slug, "translated")
    if not os.path.isdir(tdir):
        raise FileNotFoundError(f"không thấy thư mục bản dịch: {tdir}")
    plans: list[ChapterPlan] = []
    for fname in sorted(os.listdir(tdir)):
        if not fname.endswith(".md"):
            continue
        num = chapter_num(fname)
        if num is None or (chapters and not chapters[0] <= num <= chapters[1]):
            continue
        with open(os.path.join(tdir, fname), encoding="utf-8") as f:
            plans.append(plan_chapter(slug, voice, num, f.read(), fname))
    plans.sort(key=lambda p: p.chapter)
    return plans


def print_plan(plans: list[ChapterPlan], out=None) -> None:
    out = out or sys.stdout  # lấy lúc gọi (không cố định lúc định nghĩa hàm)
    total_chars = sum(p.chars for p in plans)
    total_bytes = sum(p.est_bytes for p in plans)
    for p in plans:
        print(f"  ch {p.chapter:>5}  đoạn {p.paragraphs:>4}  khúc {p.chunks:>4}  "
              f"{p.chars:>7} ký tự  ~{p.est_seconds / 60:5.1f} phút  ~{fmt_bytes(p.est_bytes):>9}  → {p.mp3_key}",
              file=out)
    print(f"Tổng: {len(plans)} chương, {total_chars} ký tự, ~{estimate_seconds(total_chars) / 3600:.1f} giờ audio, "
          f"~{fmt_bytes(total_bytes)} MP3 (+ JSON mốc đoạn, không đáng kể).", file=out)


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv=None, env=None) -> int:
    ap = argparse.ArgumentParser(description="KHUNG sinh trước audio TTS theo chương (chưa sinh audio thật).")
    ap.add_argument("--novel", required=True, help="slug truyện trong novels/")
    ap.add_argument("--voice", default=DEFAULT_VOICE, choices=VOICES)
    ap.add_argument("--chapters", default=None, help="5 hoặc 1-20 (mặc định: mọi chương)")
    ap.add_argument("--provider", default="edge", choices=sorted(PROVIDERS))
    ap.add_argument("--dry-run", action="store_true", help="chỉ in kế hoạch + ước tính dung lượng (không gọi provider)")
    ap.add_argument("--json", dest="json_out", action="store_true", help="in kế hoạch dạng JSON (dùng với --dry-run)")
    ap.add_argument("--novels-dir", default=NOVELS_DIR, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    enabled = is_enabled(env)
    if not enabled and not args.dry_run:
        print(f"[TẮT] TTS pregen đang tắt ({ENV_FLAG} chưa bật). Không làm gì. "
              f"Dùng --dry-run để xem kế hoạch, hoặc đặt {ENV_FLAG}=1 khi provider đã được duyệt.")
        return EXIT_DISABLED

    try:
        plans = plan_novel(args.novel, args.voice, parse_range(args.chapters), novels_dir=args.novels_dir)
    except (FileNotFoundError, ValueError) as e:
        print(f"[LỖI] {e}", file=sys.stderr)
        return EXIT_NOT_FOUND

    if args.dry_run:
        if args.json_out:
            print(json.dumps([{k: v for k, v in p.__dict__.items() if k != "chunk_list"} for p in plans],
                             ensure_ascii=False, indent=2))
        else:
            print(f"[DRY-RUN] {args.novel} · giọng {args.voice} · provider {args.provider}"
                  f"{'' if enabled else f' · ({ENV_FLAG} đang tắt)'}")
            print_plan(plans)
        return EXIT_OK

    provider = PROVIDERS[args.provider]()
    for p in plans:
        try:
            # Khi có provider thật: synth từng khúc → ghép MP3 → chapter_manifest → ghi R2 (p.mp3_key/p.json_key).
            for ch in p.chunk_list:
                provider.synthesize(ch["text"], args.voice)
        except NotImplementedError as e:
            print(f"[CHƯA HỖ TRỢ] {e}", file=sys.stderr)
            return EXIT_PROVIDER
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
