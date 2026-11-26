# Kế hoạch đợt 3: TTS client, nhiều bản dịch, gợi ý Hán Việt — 2026-11-26

Nhánh `feature/competitor-learnings`. Không chạm production. Người dùng đã chốt: Hán Việt = Unihan `kVietnamese` + âm suy từ glossary; TTS = chỉ client đợt này (server chỉ dựng khung, tắt mặc định); nhiều bản dịch = MVP đầy đủ.

Kết quả E2E trước đợt này: 12/12 mục PASS (`tests/browser/e2e_engagement.py`), phát hiện lỗi modal luôn phủ Reader (đã vá ở `ae0a464` và nhánh riêng `hotfix/reader-modal-overlay` từ `origin/dev`).

## C. Gợi ý âm Hán Việt
- `tools/build_hanviet.py`: Unihan `kVietnamese` (giấy phép Unicode v3, giữ NOTICE) + đếm âm từ glossary các truyện (cặp zh/vi có số chữ = số âm tiết) làm lớp ưu tiên + `tools/converter/hanviet_overrides.json`. Sinh `frontend/src/data/hanviet.json` (tải lười bằng dynamic import) và `tools/converter/data/chinese_phienam.txt` cho `vietphrase.py`. Ghi `THIRD_PARTY_LICENSES.md`.
- `utils/hanviet.js` + dòng "Hán Việt: …" trong hộp sửa name, chữ nhiều âm chọn được, nút "Dùng" theo 5 kiểu viết hoa.
- Sửa luôn style hai modal (đang dùng class Tailwind nhưng dự án không build Tailwind).

## A1. TTS client
- `utils/ttsQueue.js` (thuần) + viết lại `hooks/useTextToSpeech.js`: đọc theo đoạn/khúc ≤ 220 ký tự từ đoạn đang thấy, tô sáng + tự cuộn, cập nhật tiến độ đoạn, Media Session (+ audio im lặng cho Android), tự sang chương (cờ sessionStorage 30 giây), cài đặt `ttsAutoNext`, `ttsAutoScroll`.
- Khung server: `tools/tts_pregen.py` với giao diện provider (edge/azure chưa bật), cờ `HACDAO_TTS_ENABLED` mặc định tắt; KHÔNG sinh audio, KHÔNG thêm bước CI.

## B. Một truyện nhiều bản dịch (MVP)
- Migration `016_editions.sql`: bảng `editions`, `edition_chapters`, cột `novels.edition_count`. Bản AI hiện tại là bản mặc định ngầm định `he-thong` (không có dòng DB).
- Worker: `GET /api/novels/:slug/editions`, `GET /api/novels/:slug/editions/:code/chapters[/:id]`, `POST /api/sync/edition` (SYNC_KEY, ALLOW_SYNC_WRITES, ≤ 2 MB/25 chương); route cũ giữ nguyên từng byte; chạy được trước migration.
- `migrate_to_cloudflare.py --edition <code>` đọc `novels/<slug>/editions/<code>/`; bắt buộc `license_note`.
- Frontend: `?ban=<code>` trong Reader + `chapterUrl`, bộ chọn bản dịch ở NovelPage (chỉ khi `edition_count > 0`), `sw.js` cache route mới, trang bản dịch phụ `noindex`.

## Verify
Test Worker/frontend/pytest, eslint, build, chạy lại E2E, review độc lập, báo cáo + WORKLOG.
