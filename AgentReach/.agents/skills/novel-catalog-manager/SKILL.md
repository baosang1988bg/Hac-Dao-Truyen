---
name: novel-catalog-manager
description: >-
  Kỹ năng quản lý mục lục truyện, hỗ trợ tìm kiếm chủ động, tự động so sánh và tải danh sách chương từ Qidian, 69shuba, ixdzs8, novel543, truyendich.ai về file Markdown phân cấp cục bộ.
---

# Quản lý Mục lục Truyện (novel-catalog-manager)

## Overview
Kỹ năng này cung cấp giải pháp tự động hóa giúp Agent tự động tìm kiếm trực tuyến các liên kết truyện trên nhiều nguồn (cả tiếng Trung gốc và tiếng Việt dịch), so sánh số lượng chương để tải mục lục từ nguồn tốt nhất và lưu trữ dưới dạng file Markdown phân cấp tại cây thư mục `novel/` trong dự án. Kỹ năng hỗ trợ cập nhật tiếp nối (incremental update) đối với truyện đang liên tải.

## Dependencies
*   Python 3.10 trở lên
*   Hệ sinh thái `uv` hoặc `python3` để chạy script.

## Quick Start
Khi người dùng yêu cầu: *"Tìm mục lục truyện [Tên truyện]"* hoặc *"Cập nhật mục lục truyện [Tên truyện]"*:

1.  **Tự động tìm kiếm nguồn tốt nhất (Tiếng Việt)**:
    ```bash
    python3 scripts/novel_catalog.py fetch --name "Tên Truyện" --best --lang vi
    ```
    *Script sẽ tự động tìm kiếm trên DuckDuckGo, chọn nguồn tiếng Việt có nhiều chương nhất (thường là truyendich.ai) và tải về.*

2.  **Tự động tải nguồn tốt nhất (Tiếng Trung gốc)**:
    ```bash
    python3 scripts/novel_catalog.py fetch --name "Tên Truyện" --best --lang cn
    ```

3.  **Xem các nguồn khả dụng**:
    ```bash
    python3 scripts/novel_catalog.py search-online --name "Tên Truyện"
    ```

4.  **Kết quả**: File mục lục Markdown sẽ được lưu trữ tại `novel/<tên_nguồn>/<tên_truyện>.md`.

## Utility Scripts
Script `/Users/sangpls/Documents/AI00/AgentReach/scripts/novel_catalog.py` hỗ trợ các subcommand:

*   `fetch`: Lấy hoặc cập nhật mục lục của truyện.
    *   `--name`: Tên truyện (dùng đặt tên file và thư mục).
    *   `--url`: URL cụ thể của truyện trên nền tảng nguồn (nếu có, không cần truyền nếu dùng `--best`).
    *   `--source`: Chỉ định nguồn phân tích (`qidian`, `69shuba`, `ixdzs`, `novel543`, `truyendich`). Mặc định tự phát hiện từ URL.
    *   `--best`: Tự động chọn nguồn trực tuyến có nhiều chương nhất.
    *   `--lang`: Ngôn ngữ ưu tiên (`vi` hoặc `cn`). Mặc định: `vi`.
    *   `--output-dir`: Thư mục gốc lưu trữ mục lục (mặc định: `novel`).

*   `search-online`: Tìm kiếm truyện trực tuyến và liệt kê số lượng chương của các nguồn tìm được.
    *   `--name`: Tên truyện cần tìm kiếm.

## Common Mistakes
1.  **Tìm kiếm sai tên truyện**: Hãy sử dụng tên truyện chính thức (bằng tiếng Việt hoặc tiếng Trung gốc) để tối ưu hóa kết quả tìm kiếm trên DuckDuckGo.
2.  **Nghẽn mạng do Cloudflare**: Đối với các nguồn bị chặn IP local (như 69shuba, novel543), script sẽ tự động gọi qua Jina Reader (`https://r.jina.ai/`). Nguồn `truyendich.ai` hỗ trợ API trực tiếp không bị chặn và tải rất nhanh.
