# 🤖 Kế Hoạch Tích Hợp Google ADK — Multi-Agent Pipeline

> Trạng thái: **Chờ implement** | Ưu tiên: **Cao**  
> Mục tiêu: Biến project dịch truyện đơn giản thành pipeline AI đa agent có khả năng tự học, tự kiểm tra chất lượng.

---

## 📋 Tổng Quan

### Vấn Đề Hiện Tại
- Dịch 1 lần duy nhất → chất lượng phụ thuộc hoàn toàn vào 1 prompt
- `fix_chapters.py`, `fix_truncated.py` phải chạy **tay** sau khi dịch xong
- Glossary chỉ cập nhật khi người dùng tự thêm
- Không có cơ chế kiểm tra chất lượng tự động trong pipeline

### Giải Pháp ADK
Dùng **Google Agent Development Kit (ADK)** để tổ chức các bước xử lý thành pipeline agent rõ ràng, có thể bật/tắt từng bước, và tự động hóa QC.

---

## 🏗️ Kiến Trúc Pipeline

```
FastAPI (api.py)
    └── NovelTranslationOrchestrator (SequentialAgent — ADK)
            ├── ScraperAgent        → crawl HTML → raw text
            ├── TranslatorAgent     → Pass 1: dịch nhanh, draft
            ├── PolishAgent         → Pass 2: cải thiện văn phong (tùy chọn)
            ├── QCAgent             → kiểm tra Hán tự, ratio, lỗi
            └── GlossaryAgent       → auto-learn tên nhân vật mới
```

### Nguyên Tắc Thiết Kế
- **Không rewrite code cũ** — mỗi agent chỉ *wrap* code hiện có
- **Bật/tắt từng bước** qua `.env` — Pass 2 tốn thêm API calls
- **Fallback** — nếu ADK lỗi, api.py vẫn có thể gọi `cmd_translate_async()` cũ
- **Thay đổi tối thiểu** với `api.py` và frontend

---

## 📅 Kế Hoạch 3 Giai Đoạn

### ✅ Giai Đoạn 1 — Foundation (1–2 ngày)
> Mục tiêu: Chạy được pipeline cơ bản, không thay đổi UX

- [ ] Cài `google-adk` vào `requirements.txt`
- [ ] Tạo thư mục `agents/`
- [ ] Tạo `agents/scraper_agent.py` — wrap `NovelScraper`
- [ ] Tạo `agents/translator_agent.py` — wrap `NovelTranslator` (pass 1)
- [ ] Tạo `agents/orchestrator.py` — `SequentialAgent` điều phối
- [ ] Patch `api.py`: gọi `orchestrator.run()` thay vì `cmd_translate_async()`
- [ ] Test: dịch 3 chương thử, so sánh output với code cũ

**Rủi ro:** Thấp — code cũ vẫn còn, có thể rollback bất cứ lúc nào.

---

### ✅ Giai Đoạn 2 — Quality Enhancement — ĐÃ TRIỂN KHAI (2026-09-10)
> Mục tiêu: Tăng chất lượng bản dịch thực sự
>
> Xem đầy đủ kiến trúc/luồng tại
> `docs/superpowers/specs/2026-09-10-adk-pass2-qc-design.md` (nguồn sự thật).
> **Trạng thái thực tế**: đã implement + test mock đầy đủ (không gọi AI/network
> thật trong test). **CHƯA chạy production** — 4 cờ env vẫn mặc định tắt, chưa
> ai bật thử với chương thật/provider thật.

- [x] Tạo `agents/polish_agent.py` — `PolishAgent` bọc method MỚI
      `NovelTranslator.polish_chapter` (translator.py) — Pass 2 với prompt
      khác Pass 1 (`build_polish_prompt`):
  - Pass 1 prompt (`build_prompt`, không đổi): *speed, accuracy, completeness*
  - Pass 2 prompt (`build_polish_prompt`, MỚI): *natural Vietnamese flow,
    pronoun consistency, literary feel* — tái dùng nguyên cơ chế xoay vòng
    key/retry/fallback provider đã có (`_call_gemini`/`_call_deepseek`/
    `_call_groq`/`_call_ollama`), không tạo đường gọi API song song riêng.
- [x] Tạo `agents/qc_agent.py`:
  - Detect Hán tự còn sót (`[一-鿿]`) — hàm thuần `check_translation_quality()`,
    test độc lập không cần ADK (`tests/test_qc_agent.py`, 11 test).
  - Kiểm tra tỷ lệ độ dài bản dịch / bản gốc (< 0.3 hoặc > 3.0 → fail).
  - Nếu fail → `agents/orchestrator.py` (`run_pass2_qc_for_chapter`, code
    Python thường — for/while đếm số lần, KHÔNG dùng LLM-driven loop) tự
    retry Pass 1/Polish theo `ADK_QC_MAX_RETRY`/`ADK_PASS2_MAX_RETRY`, không
    cần chạy `fix_chapters.py` tay.
  - Hết retry vẫn fail: dùng bản TỐT NHẤT theo thứ tự ưu tiên (polish đã pass
    QC > Pass 1 đã pass QC > Pass 1 gốc), ghi cảnh báo vào
    `novels/<slug>/failed_chapters.json` (tái dùng nguyên
    `pipeline._record_failed_chapter`, không tạo file trạng thái mới) — không
    raise lỗi, không chặn lưu file.
- [x] Thêm config vào `.env` (đọc qua `agents/__init__.py`, mặc định TẤT CẢ tắt):
  ```env
  ADK_ENABLED=true
  ADK_QC_ENABLED=false        # bật QC (Hán tự sót + tỷ lệ độ dài) sau Pass 1
  ADK_PASS2_ENABLED=false     # bật Polish (Pass 2) sau khi Pass 1 pass QC
  ADK_QC_MAX_RETRY=2          # số lần tối đa gọi lại Pass 1 khi QC fail
  ADK_PASS2_MAX_RETRY=2       # số lần tối đa gọi lại Polish khi QC (lần 2) fail
  ```
- [x] Cost tracking: `PolishAgent`/`polish_chapter` log `[💰]` đúng format đã
      dùng ở Pass 1 (tái dùng `estimate_tokens`/`estimate_cost`, không bịa
      công thức mới); usage sau Pass 2 cộng dồn Pass 1 + mọi retry + Polish
      vào 1 dict tổng (`_aggregate_usage` trong orchestrator.py) — không mất
      số liệu Pass 1.
- [x] Test: `tests/test_qc_agent.py` (11 test) + `tests/test_orchestrator_pass2_qc.py`
      (15 test) — mock hoàn toàn `translate_chapter_standalone`/
      `polish_chapter_standalone`/`check_translation_quality`, KHÔNG gọi
      `google.genai`/network thật. Baseline trước khi thêm: 228 test Python
      PASS; sau khi thêm 26 test mới: 256 test Python PASS (chạy
      `.venv/bin/python -m pytest -q`).
- [ ] Update Web UI: hiển thị stage hiện tại trong progress bar — CHƯA làm,
      ngoài phạm vi spec 2026-09-10 (chỉ backend/orchestrator).

**Lưu ý API calls:**
| Chế độ | API calls/chương |
|---|---|
| Hiện tại | 1 call |
| Pass 1 only | 1 call (tương đương) |
| Pass 1 + QC | 1.1 call (QC nhẹ) |
| Pass 1 + Pass 2 + QC | 2–3 calls |

Với 5 key × 1500 req/ngày = 7500 req: Pass 2 sẽ giảm throughput còn ~2500 chương/ngày.

---

### 🚀 Giai Đoạn 3 — Advanced (tùy chọn)
> Mục tiêu: Self-improving pipeline

- [ ] Tạo `agents/glossary_agent.py`:
  - Sau mỗi chương, extract tên nhân vật/địa danh mới chưa có trong glossary
  - Tự động thêm vào `novel.json` với transliteration đề xuất
  - User review và approve qua Web UI
- [ ] WebSocket progress thay vì polling (smoother UI)
- [ ] Parallel agents: dịch nhiều chương song song khi batch lớn
- [ ] Agent memory: context từ chương trước tự động truyền sang chương sau

---

## 📁 Cấu Trúc File Dự Kiến

```
HacDaoTruyen/
├── agents/                          ← NEW
│   ├── __init__.py
│   ├── orchestrator.py              ← SequentialAgent chính
│   ├── scraper_agent.py             ← wrap NovelScraper
│   ├── translator_agent.py          ← wrap NovelTranslator (pass 1)
│   ├── polish_agent.py              ← Pass 2 (giai đoạn 2)
│   ├── qc_agent.py                  ← QC + auto-retry (giai đoạn 2)
│   └── glossary_agent.py            ← auto-learn (giai đoạn 3)
├── plans/                           ← NEW (thư mục này)
│   └── adk-agents/
│       ├── README.md                ← file này
│       └── research-notes.md        ← ghi chú nghiên cứu ADK
├── api.py                           ← sửa nhỏ: gọi orchestrator
├── main.py                          ← giữ nguyên (CLI vẫn dùng)
├── translator.py                    ← giữ nguyên (được wrap bởi agent)
└── scraper.py                       ← giữ nguyên (được wrap bởi agent)
```

---

## ⚠️ Trade-offs Cần Biết

### ADK phù hợp khi:
- Muốn Pass 2 dịch thực sự (giá trị rõ ràng)
- Muốn QC tự động không cần chạy script tay
- Muốn pipeline có thể mở rộng thêm agent sau này

### ADK KHÔNG phù hợp khi:
- Chỉ cần tăng tốc độ dịch (code hiện tại đã đủ tốt)
- Budget API calls eo hẹp (Pass 2 tốn gấp đôi)
- Không có thời gian maintain thêm layer abstraction

### Lựa chọn thay thế đơn giản hơn (Hướng 1):
Nếu muốn Pass 2 mà không cần ADK, chỉ cần thêm tham số `--pass2` vào `main.py` và gọi `translate_chapter()` 2 lần với 2 prompt khác nhau. Ít code hơn, dễ maintain hơn, nhưng không có agent orchestration.

---

## 🔗 Tài Nguyên

- [Google ADK Python Docs](https://google.github.io/adk-python/)
- [ADK SequentialAgent Examples](https://github.com/google/adk-python/tree/main/examples)
- [google-adk PyPI](https://pypi.org/project/google-adk/) — current version: 1.32.0
- Code hiện tại tham khảo: `translator.py`, `scraper.py`, `api.py`, `main.py`

---

*Tạo: 2026-05-07 | Cập nhật khi có tiến độ mới*
