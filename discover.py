"""
discover.py
-----------
Công cụ khám phá và gợi ý truyện Trung Quốc — không cần biết tiếng Trung.

Dùng Gemini để:
1. Gợi ý truyện hot theo thể loại bạn thích
2. Mô tả nội dung bằng tiếng Việt
3. Tìm URL để download và dịch

Cách dùng:
    python discover.py                          # gợi ý truyện hot tổng hợp
    python discover.py --genre cultivation      # tu tiên
    python discover.py --genre romance          # ngôn tình
    python discover.py --genre modern           # đô thị
    python discover.py --genre isekai           # xuyên không / trọng sinh
    python discover.py --genre game             # game / hệ thống
    python discover.py --genre military         # quân sự
    python discover.py --like "thú cưỡi thú"   # tương tự truyện đang dịch
    python discover.py --save                   # lưu kết quả
"""

import argparse
import os
from datetime import datetime

# ── Genre map ─────────────────────────────────────────────────────────────────

GENRES = {
    "all":        "Tất cả thể loại — top hot nhất hiện tại",
    "cultivation":"Tu tiên / Luyện khí / Võ đạo (玄幻仙侠)",
    "romance":    "Ngôn tình / Tình cảm lãng mạn (言情爱情)",
    "modern":     "Đô thị / Hiện đại / Thương trường (都市)",
    "isekai":     "Xuyên không / Trọng sinh /穿越重生",
    "game":       "Trò chơi / Hệ thống / Vô hạn lưu (游戏系统)",
    "military":   "Quân sự / Chiến tranh / Đặc chủng (军事)",
    "historical": "Cổ đại / Lịch sử / Cung đình (历史古代)",
    "scifi":      "Khoa học viễn tưởng / Không gian (科幻)",
    "horror":     "Kinh dị / Ma quái / Bí ẩn (恐怖悬疑)",
    "beast":      "Ngự thú / Thánh thú / Dị giới thú (御兽异兽)",
    "farming":    "Điền văn / Phục công / Chăn nuôi (田园种地)",
    "esports":    "Thể thao điện tử / Cạnh tranh (竞技电竞)",
}


# ── Gemini ────────────────────────────────────────────────────────────────────

def get_gemini_client():
    from dotenv import load_dotenv
    load_dotenv()
    from google import genai
    keys = os.getenv("GOOGLE_API_KEYS", os.getenv("GOOGLE_API_KEY", ""))
    key = [k.strip() for k in keys.split(",") if k.strip()][0]
    model = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    client = genai.Client(api_key=key)
    return client, model


def ask_gemini(client, model, prompt: str) -> str:
    try:
        resp = client.models.generate_content(model=model, contents=prompt)
        return resp.text.strip()
    except Exception as e:
        return f"[Lỗi: {e}]"


# ── Discovery prompts ─────────────────────────────────────────────────────────

def build_recommendation_prompt(genre: str, similar_to: str, top_n: int) -> str:
    genre_desc = GENRES.get(genre, genre)

    similar_section = ""
    if similar_to:
        similar_section = f"""
Người dùng muốn đọc truyện tương tự như: "{similar_to}"
Hãy ưu tiên gợi ý những truyện có cùng chủ đề hoặc cảm giác đọc.
"""

    return f"""Bạn là chuyên gia về tiểu thuyết mạng Trung Quốc (网文) với kiến thức sâu rộng về các tác phẩm hot nhất.

Nhiệm vụ: Gợi ý {top_n} tiểu thuyết mạng Trung Quốc **đang hot hoặc nổi tiếng** thuộc thể loại: {genre_desc}
{similar_section}

Yêu cầu:
- Ưu tiên những truyện đã hoàn thành hoặc đang ra chương đều đặn
- Bao gồm cả truyện kinh điển (đã nổi tiếng) và truyện hot gần đây (2022-2024)
- Ưu tiên những truyện có thể tìm được trên 69shuba.com

Với mỗi truyện, cung cấp theo ĐÚNG định dạng này:

---
**Số thứ tự. [Tên Việt] / [Tên Trung]**
- 📝 Tác giả: [tên tác giả Trung]
- 🏷 Thể loại: [tag cụ thể]
- 📖 Tóm tắt: [3-5 câu mô tả nội dung chính, không tiết lộ spoiler lớn, viết hấp dẫn bằng tiếng Việt]
- ⭐ Điểm mạnh: [1-2 lý do nên đọc]
- 🔍 Từ khóa tìm: [tên truyện tiếng Trung để tìm kiếm]
- 📊 Trạng thái: [Đang ra / Hoàn thành] — Khoảng [số] chương
---

Hãy liệt kê đủ {top_n} truyện theo thứ tự từ hot nhất / nổi tiếng nhất."""


def build_search_help_prompt(novel_title_zh: str) -> str:
    return f"""Tôi muốn tìm tiểu thuyết Trung Quốc này để đọc và dịch sang tiếng Việt:
Tên: {novel_title_zh}

Hãy cung cấp:
1. ID hoặc URL trên trang 69shuba.com (định dạng: https://www.69shuba.com/txt/[số_id]/[số_chương])
2. ID hoặc URL trên Qidian.com nếu có
3. Tên tác giả đầy đủ
4. Số chương khoảng bao nhiêu
5. URL chương đầu tiên nếu biết

Nếu không biết chính xác URL, hãy hướng dẫn tôi cách tìm truyện này trên 69shuba.com."""


# ── Display ───────────────────────────────────────────────────────────────────

def print_header(genre: str, similar_to: str = ""):
    genre_desc = GENRES.get(genre, genre)
    print(f"\n{'═'*65}")
    print(f"  📚  KHÁM PHÁ TRUYỆN TRUNG QUỐC")
    print(f"  🎯  Thể loại: {genre_desc}")
    if similar_to:
        print(f"  🔗  Tương tự: {similar_to}")
    print(f"  📅  {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    print(f"{'═'*65}")


def print_footer():
    print(f"\n{'─'*65}")
    print("  💡 Sau khi chọn được truyện:")
    print("     1. Tìm URL chương đầu trên 69shuba.com")
    print("     2. Chạy: python main.py new")
    print("     3. Nhập thông tin truyện khi được hỏi")
    print("     4. Chạy: python main.py translate --novel <slug> --chapters 10")
    print()
    print("  🔍 Để tìm URL nhanh:")
    print("     • Vào https://www.69shuba.com")
    print("     • Tìm kiếm tên truyện tiếng Trung")
    print("     • Copy URL chương 1 từ mục lục")
    print(f"{'─'*65}\n")


def save_result(content: str, genre: str, output_dir: str = "discover_results"):
    os.makedirs(output_dir, exist_ok=True)
    filename = f"{output_dir}/goi_y_{genre}_{datetime.now().strftime('%Y%m%d_%H%M')}.md"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(f"# Gợi ý truyện — {GENRES.get(genre, genre)}\n")
        f.write(f"*Cập nhật: {datetime.now().strftime('%d/%m/%Y %H:%M')}*\n\n")
        f.write(content)
    print(f"\n[✓] Đã lưu vào: {filename}")
    return filename


# ── Interactive mode ──────────────────────────────────────────────────────────

def interactive_search(client, model):
    """Chế độ hỏi đáp về một truyện cụ thể."""
    print("\n" + "─"*50)
    print("  🔎 Tìm thông tin truyện cụ thể")
    print("─"*50)
    print("  Nhập tên truyện tiếng Trung hoặc tiếng Việt:")
    novel_name = input("  > ").strip()
    if not novel_name:
        return

    print(f"\n[*] Đang tìm thông tin '{novel_name}'...")
    prompt = build_search_help_prompt(novel_name)
    result = ask_gemini(client, model, prompt)
    print("\n" + result)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="🔍 Khám phá truyện Trung Quốc hot — không cần biết tiếng Trung",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--genre", "-g",
        choices=list(GENRES.keys()),
        default="all",
        help="Thể loại truyện:\n" + "\n".join(f"  {k:<12} = {v}" for k, v in GENRES.items()),
    )
    parser.add_argument(
        "--like", "-l",
        type=str,
        default="",
        metavar="MÔ_TẢ",
        help="Tìm truyện tương tự ví dụ: --like \"ngự thú, nữ chính mạnh mẽ\"",
    )
    parser.add_argument(
        "--top", "-n",
        type=int,
        default=10,
        help="Số lượng truyện gợi ý (mặc định: 10)",
    )
    parser.add_argument(
        "--save",
        action="store_true",
        help="Lưu kết quả ra file Markdown trong discover_results/",
    )
    parser.add_argument(
        "--search", "-s",
        action="store_true",
        help="Tìm kiếm thông tin về một truyện cụ thể (URL, số chương...)",
    )

    args = parser.parse_args()

    print("\n[*] Đang kết nối Gemini...")
    try:
        client, model = get_gemini_client()
        print(f"[✓] Gemini ready — model: {model}")
    except Exception as e:
        print(f"[!] Không thể kết nối Gemini: {e}")
        print("    Kiểm tra lại GOOGLE_API_KEYS trong file .env")
        return

    # Chế độ tìm kiếm truyện cụ thể
    if args.search:
        interactive_search(client, model)
        return

    # Chế độ gợi ý
    print_header(args.genre, args.like)
    print(f"\n[*] Đang tạo danh sách {args.top} truyện gợi ý...")
    print("    (Vui lòng chờ 10-30 giây...)\n")

    prompt = build_recommendation_prompt(args.genre, args.like, args.top)
    result = ask_gemini(client, model, prompt)

    print(result)
    print_footer()

    if args.save:
        save_result(result, args.genre)

    # Hỏi xem có muốn tìm URL cho truyện nào không
    print("\n  Bạn có muốn tìm URL/link cho truyện nào không?")
    print("  Nhập tên truyện (tiếng Trung hoặc Việt) hoặc Enter để bỏ qua:")
    user_input = input("  > ").strip()
    if user_input:
        print(f"\n[*] Đang tìm thông tin '{user_input}'...")
        search_prompt = build_search_help_prompt(user_input)
        search_result = ask_gemini(client, model, search_prompt)
        print("\n" + search_result)
        print_footer()


if __name__ == "__main__":
    main()
