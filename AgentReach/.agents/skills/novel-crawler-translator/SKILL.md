---
name: novel-crawler-translator
description: >-
  Kỹ năng tự động quét và sửa lỗi thiếu trang (ví dụ phần 2/2) cho các chương bị phân trang (chương có "(1/2)" hoặc "(1-2)" trong tên), ghép trang 2 thô và dịch đơn lẻ đa luồng (BATCH_SIZE=1) tránh lỗi mất nội dung.
---

# Quét và dịch bổ sung trang phân trang (novel-crawler-translator)

## Overview
Kỹ năng này tự động phát hiện, sửa lỗi và dịch lại toàn bộ nội dung cho các chương bị phân trang trên nguồn `novel543` (thường xuất hiện dưới dạng tiêu đề thô chứa `(1/2)` hoặc file raw chứa `(1-2)`). 

Do cơ chế dự phòng Jina Reader không nhận diện được phân trang, và việc dịch gộp (batch translation) dễ làm AI bỏ qua trang 2, kỹ năng này cung cấp quy trình 3 bước khép kín để cập nhật bản dịch đầy đủ nhất.

## Quy trình Thực hiện (Workflow)

Khi người dùng phản ánh: *"Chương X bị thiếu phần 2"* hoặc *"Tại sao các chương (1/2) bị quá ngắn"*:

1.  **Quét và tải ghép Trang 2**:
    Chạy kịch bản `crawl_and_merge_page2.py` để tìm các file raw chứa `(1-2).txt`, tải về trang thứ 2 (`_2.html`) từ `novel543` qua Jina Reader, ghép trực tiếp vào cuối file raw và xóa bản dịch lỗi/thiếu cũ:
    ```bash
    python3 AgentReach/.agents/skills/novel-crawler-translator/scripts/crawl_and_merge_page2.py
    ```

2.  **Dịch lại đơn lẻ đa luồng (BATCH_SIZE=1)**:
    Chạy dịch song song với `BATCH_SIZE=1` để dịch chi tiết từng chương (không dịch gộp tránh mất chữ) với cấu hình đa luồng 5 connections:
    ```bash
    python3 AgentReach/.agents/skills/novel-crawler-translator/scripts/retranslate_parallel.py
    ```

3.  **Dọn dẹp tên file đầu ra (Rename)**:
    Chạy kịch bản đổi tên để xoá các hậu tố ` 1-2` tạm thời trong thư mục `translated/` nhằm đồng bộ chính xác với mục lục `catalog.json`:
    ```bash
    python3 AgentReach/.agents/skills/novel-crawler-translator/scripts/rename_translated.py
    ```

4.  **Đồng bộ Cloudflare (nếu có)**:
    ```bash
    python3 migrate_to_cloudflare.py --slug toan-cau-cau-sinh-khai-cuc-mot-chiec-be-go
    ```

## Utility Scripts
Các script bổ trợ được lưu trữ tại `AgentReach/.agents/skills/novel-crawler-translator/scripts/`:
*   `crawl_and_merge_page2.py`: Tải trang 2, ghép nội dung thô.
*   `retranslate_parallel.py`: Chạy dịch lại tối ưu hóa đơn lẻ.
*   `rename_translated.py`: Đồng bộ tên file theo mục lục.
*   `delete_splits_translated.py`: Xoá nhanh các file đã dịch cũ của chương phân trang.
