# Spec: ADK Pass 2 (Polish) + QC tự động — Giai đoạn 2 kế hoạch ADK

Ngày: 2026-09-10
Phạm vi: `plans/KE_HOACH_NANG_CAP_TONG_THE_2026-08-14.md` mục 3.1 ("Hoàn thiện ADK Giai đoạn 2")
Tiền đề: `plans/adk-agents/README.md` (kế hoạch gốc 3 giai đoạn), `plans/adk-agents/research-notes.md` (rủi ro kỹ thuật)

## 1. Bối cảnh và vì sao cần spec riêng

ADK Giai đoạn 1 (Foundation) đã xong: `agents/orchestrator.py` chạy `ScraperAgent → TranslatorAgent` (chỉ Pass 1) cho **đúng 1 chương**, đứng sau cờ `ADK_ENABLED` (mặc định `false`), có fallback try/except toàn diện về `main.cmd_translate_async()` khi import lỗi. `agents/` hiện có **0 test**. Việc thêm Pass 2 (polish văn phong) + QC tự động (phát hiện lỗi dịch) là thay đổi kiến trúc — tốn thêm 2-3x chi phí AI/chương khi bật — nên cần spec + kế hoạch triển khai riêng thay vì làm trực tiếp như các việc bounded (#2, #3) đã xong.

Quyết định đã chốt với người dùng (qua brainstorming):
- Làm **cả QC agent và Polish agent cùng lúc** (không chia nhỏ thêm giai đoạn), chấp nhận chi phí tăng 2-3x/chương khi bật cả hai.
- Chỉ tích hợp trong **nhánh ADK orchestrator riêng** (`agents/orchestrator.py`), **không đụng vào `pipeline.py`/`translator.py`** hay luồng dịch batch/song song chính đang chạy ổn định hàng ngày.
- Khi QC fail sau khi hết số lần retry: **vẫn lưu bản dịch tốt nhất đã có**, gắn cờ cảnh báo vào `failed_chapters.json` để admin xem lại thủ công — không chặn xuất bản, không xoá tiến độ.

## 2. Ngoài phạm vi (out of scope)

- Không tích hợp Pass 2/QC vào `pipeline.py`/`translator.py` hay luồng dịch batch/song song chính — đó là thay đổi rủi ro cao hơn nhiều, để lại quyết định riêng sau này nếu ADK orchestrator chứng minh ổn định.
- Không làm `agents/glossary_agent.py` (Giai đoạn 3) — ngoài phạm vi spec này.
- Không thêm khả năng batch/song song cho orchestrator (vẫn xử lý tuần tự từng chương như Giai đoạn 1).
- Không tự động bật `ADK_ENABLED`, `ADK_QC_ENABLED`, `ADK_PASS2_ENABLED` trong môi trường nào — mọi cờ mặc định tắt, người vận hành tự bật khi sẵn sàng.

## 3. Kiến trúc & luồng chạy

Mở rộng `SequentialAgent` trong `agents/orchestrator.py`. Pass 1 giữ nguyên (`TranslatorAgent` hiện có, không sửa). Thêm 2 agent mới, nối tiếp có điều kiện:

```
ScraperAgent → TranslatorAgent (Pass 1)
                    │
                    ▼
         [ADK_QC_ENABLED?] ──false──▶ (bỏ qua QC, đi thẳng xuống Pass 2 hoặc kết thúc)
                    │ true
                    ▼
              QCAgent.check(translated_text, raw_content)
                    │
        ┌───────pass─┴─fail (retry < ADK_QC_MAX_RETRY)─┐
        ▼                                               ▼
  [ADK_PASS2_ENABLED?]                          gọi lại TranslatorAgent
        │ false → kết thúc, dùng bản Pass 1           (Pass 1, chương cũ)
        │ true                                          │
        ▼                                    (quay lại QCAgent.check, đếm retry)
   PolishAgent.polish(translated_text)
        │
        ▼
   QCAgent.check(polished_text, raw_content)   ← QC lần 2, kiểm tra polish không sinh lỗi mới
        │
  ┌─pass─┴─fail (retry < ADK_PASS2_MAX_RETRY)─┐
  ▼                                            ▼
kết thúc, dùng bản polish              gọi lại PolishAgent
                                               │
                                  (quay lại QCAgent.check, đếm retry)

Hết retry ở bất kỳ vòng nào mà vẫn fail:
  → dùng bản TỐT NHẤT đã có (ưu tiên: bản polish từng pass QC riêng >
     bản Pass 1 pass QC > bản Pass 1 gốc nếu QC tắt)
  → ghi vào failed_chapters.json kèm lý do QC fail cụ thể
  → KHÔNG raise lỗi ra ngoài, KHÔNG chặn lưu file
```

Lý do QC chạy 2 lần (sau Pass 1 và sau Pass 2) thay vì 1 lần cuối: tránh tốn chi phí Polish (đắt nhất, gấp 1-2x Pass 1) trên một bản dịch còn lỗi Hán tự sót/cắt cụt cơ bản — QC gate trước khi vào Polish.

## 4. Components mới

### 4.1 `agents/qc_agent.py`

`BaseAgent` (custom, deterministic, KHÔNG dùng LLM để quyết định — giữ đúng nguyên tắc đã áp dụng cho `ScraperAgent`/`TranslatorAgent`, không phát sinh AI call ngoài dự kiến).

```python
class QCAgent(BaseAgent):
    def __init__(self, name: str = "qc_agent", **kwargs): ...

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        # Input (session.state): "translated_text" (hoặc "polished_text" nếu có),
        #                         "chapter_content" (bản gốc, để tính tỷ lệ độ dài)
        # Output (session.state): "qc_passed": bool, "qc_reason": Optional[str]
```

Logic kiểm tra (hàm thuần Python, tách riêng để test không cần ADK — theo mẫu `translate_chapter_standalone` đã có ở `translator_agent.py`):
- `check_translation_quality(original: str, translated: str) -> tuple[bool, Optional[str]]`
  - Regex Hán tự sót: `re.search(r'[一-鿿]', translated)` → fail nếu tìm thấy, `qc_reason` liệt kê ký tự/vị trí đầu tiên tìm được (không liệt kê hết, tránh log dài).
  - Tỷ lệ độ dài `len(translated) / len(original)` (đếm ký tự, khớp cách `research-notes.md`/`README.md` đã mô tả) — fail nếu `< 0.3` hoặc `> 3.0`.
  - Trả `(True, None)` nếu qua cả 2 kiểm tra.

### 4.2 `agents/polish_agent.py`

`BaseAgent` gọi LLM thật (khác `QCAgent`), theo đúng mẫu `TranslatorAgent` (wrap method có sẵn, chạy qua `asyncio.to_thread`, không block event loop).

```python
class PolishAgent(BaseAgent):
    def __init__(self, translator: Optional[NovelTranslator] = None, name: str = "polish_agent", **kwargs): ...

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        # Input (session.state): "translated_text" (bản Pass 1 đã pass QC)
        # Output (session.state): "polished_text", "usage" (cộng dồn/ghi đè theo agreement mục 4.4)
```

Cần thêm method mới trong `translator.py` (hoặc hàm độc lập trong `polish_agent.py` gọi thẳng provider client có sẵn — quyết định cụ thể ở bước implementation, không cố định trong spec) với **prompt khác Pass 1**: ưu tiên tự nhiên hoá văn phong, nhất quán đại từ nhân vật, cảm giác văn học — thay vì tốc độ/độ chính xác thô như Pass 1. Tái sử dụng cơ chế retry/fallback provider đã có trong `translator.py` (không viết lại từ đầu).

### 4.3 `agents/orchestrator.py` (sửa)

- Thêm đọc 4 biến môi trường mới (mục 5).
- Thêm vòng retry có giới hạn quanh cặp (translate-or-polish) + QC, theo đúng sơ đồ mục 3. Điểm quan trọng: vòng lặp phải là code Python thường (for loop với đếm số lần), KHÔNG dùng LLM-driven loop của ADK — giữ nguyên tắc "deterministic control flow" đã áp dụng ở Giai đoạn 1.
- Cập nhật docstring đầu file (hiện đang ghi rõ "Giới hạn Giai đoạn 1 — không có Pass 2/QC" — cần sửa lại phần này khi triển khai xong, tránh tài liệu nói sai so với code).

### 4.4 Cost tracking

`PolishAgent` phải log chi phí theo đúng format `[💰]` đã dùng ở `translator.py:616` (`print(f'  [💰] {_used_model}: ~{in_tok}→{out_tok} tokens, {cost_str}')`) — tái dùng logic tính cost hiện có trong `translator.py`, không tạo công thức tính cost mới. `usage` trong `session.state` sau Polish nên là **danh sách/tổng hợp cả 2 lần gọi** (Pass 1 + Pass 2), không ghi đè mất usage của Pass 1 — quyết định cấu trúc chính xác (list vs dict cộng dồn) ở bước implementation, miễn giữ được cả 2 số liệu để không làm sai lệch báo cáo chi phí tổng.

## 5. Config (env, tất cả mặc định tắt)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ADK_QC_ENABLED` | `false` | Bật QC sau Pass 1 (và sau Pass 2 nếu Pass 2 cũng bật) |
| `ADK_PASS2_ENABLED` | `false` | Bật Polish sau khi Pass 1 pass QC (hoặc ngay sau Pass 1 nếu QC tắt) |
| `ADK_QC_MAX_RETRY` | `2` | Số lần tối đa gọi lại Pass 1 khi QC fail |
| `ADK_PASS2_MAX_RETRY` | `2` | Số lần tối đa gọi lại Polish khi QC (lần 2) fail |

Đọc qua `os.getenv` theo đúng pattern `is_adk_enabled()` đã có ở `agents/__init__.py` (chuỗi `"1"/"true"/"yes"` không phân biệt hoa thường cho 2 cờ bool; parse int có fallback an toàn cho 2 cờ retry). Toàn bộ 4 cờ này **chỉ có ý nghĩa khi `ADK_ENABLED=true`** — giữ nguyên cổng tổng đã có.

## 6. Xử lý khi hết retry (đã chốt với người dùng)

Không raise lỗi, không chặn lưu file. Thứ tự ưu tiên bản dùng để lưu:
1. Bản polish nếu polish từng tự pass QC (dù ở lần retry nào) — chất lượng cao nhất có sẵn.
2. Bản Pass 1 nếu đã pass QC nhưng Polish/QC-lần-2 hết retry vẫn fail.
3. Bản Pass 1 gốc (chưa từng pass QC) nếu chính QC-lần-1 hết retry vẫn fail và không còn lựa chọn nào khác.

Ghi vào `failed_chapters.json` (tái dùng cấu trúc/đường dẫn đã có ở `pipeline.py`, không tạo file trạng thái mới) kèm: tên chương, lý do QC fail cụ thể (từ `qc_reason`), giai đoạn fail (Pass 1 hay Pass 2), số lần đã retry.

## 7. Testing

`agents/` hiện có 0 test — bắt buộc thêm, không AI call thật:

- `tests/test_qc_agent.py`: test hàm thuần `check_translation_quality()` — case Hán tự sót (pass/fail đúng), case tỷ lệ độ dài (biên `0.3`/`3.0`, trong khoảng, ngoài khoảng cả 2 hướng), case sạch (pass, reason=None).
- `tests/test_orchestrator_pass2_qc.py`: mock `TranslatorAgent`/`PolishAgent`/`QCAgent` (hoặc mock trực tiếp method LLM bên dưới) để giả lập chuỗi kết quả (fail N lần rồi pass, hoặc fail hết retry) — assert: (a) dừng đúng số lần retry theo `ADK_QC_MAX_RETRY`/`ADK_PASS2_MAX_RETRY`, (b) khi hết retry vẫn ghi `failed_chapters.json` đúng cấu trúc và trả về bản tốt nhất theo đúng thứ tự ưu tiên mục 6, (c) khi cờ tắt thì bỏ qua đúng bước tương ứng (không gọi QC/Polish khi tắt), (d) không có test nào gọi `google.genai`/network thật.
- Chạy `python -m pytest -q` toàn bộ xác nhận không regression (baseline hiện tại: 53 passed).

## 8. Rủi ro đã biết (từ `research-notes.md`, cần xử lý hoặc ghi nhận rõ trong lúc implement)

- ADK orchestrator vẫn chỉ xử lý 1 chương/lần, không batch — nếu muốn dùng Pass 2/QC cho khối lượng lớn sẽ chậm hơn nhiều so với pipeline chính (đã chấp nhận, ngoài phạm vi mục 2).
- Rate limiting của `key_status.json` (dùng ở `translator.py`/`pipeline.py`) cần xác nhận `PolishAgent` gọi đúng qua các hàm có sẵn để KHÔNG tạo đường gọi API song song không qua rotation key hiện có — nếu `PolishAgent` gọi thẳng client mới không qua `NovelTranslator`, phải tự đảm bảo dùng chung cơ chế xoay vòng key, không phát sinh rate-limit riêng.
- `google-adk` vẫn là dependency tuỳ chọn — `qc_agent.py`/`polish_agent.py` phải giữ đúng pattern try/except `ImportError` + cờ `ADK_AVAILABLE` như 2 file agent hiện có, không thêm `google-adk` vào `requirements.txt` mặc định.

## 9. Tiêu chí hoàn thành

- 4 cờ env mới hoạt động đúng (tắt = hành vi y hệt Giai đoạn 1, không gọi thêm AI call nào).
- Bật `ADK_QC_ENABLED=true` một mình: QC chạy sau Pass 1, retry đúng số lần, log `[💰]` không đổi so với hiện tại (QC không gọi AI).
- Bật cả `ADK_QC_ENABLED=true` + `ADK_PASS2_ENABLED=true`: đúng luồng mục 3, cost log `[💰]` xuất hiện thêm 1 dòng/lần gọi Polish.
- Test mới pass, toàn bộ suite hiện có (53 test Python) không regression.
- Docstring `agents/orchestrator.py`, `plans/adk-agents/README.md` (đánh dấu Giai đoạn 2 done) được cập nhật khớp code thật — không để tài liệu nói sai như đã từng xảy ra ở phase trước.
