# Giấy phép bên thứ ba (dữ liệu)

File này liệt kê dữ liệu của bên thứ ba được nhúng/phân phối lại trong repo.
Thư viện npm/pip dùng lúc chạy có giấy phép riêng trong `package.json` /
`requirements.txt` của từng gói, không lặp lại ở đây.

## Unicode Han Database (Unihan) — bảng âm Hán Việt

- **Dùng ở:** `frontend/src/data/hanviet.json` và
  `tools/converter/data/chinese_phienam.txt` (sinh bởi `tools/build_hanviet.py`).
- **Trường dùng:** `kVietnamese` (Unihan_Readings.txt), `kSimplifiedVariant`,
  `kTraditionalVariant` (Unihan_Variants.txt). Dữ liệu đã được biến đổi: chuẩn
  hoá chữ thường + dấu thanh kiểu mới (hòa, thủy); chỉ giữ khối CJK Unified
  Ideographs chính (U+4E00–U+9FFF) và CJK Compatibility (U+F900–U+FAFF) — bỏ cả
  CJK Ext A (U+3400–U+4DBF) lẫn mọi chữ ngoài BMP (Ext B trở đi), trừ chữ có
  trong glossary của dự án (cờ `--all-planes` giữ lại tất cả); âm glossary
  xuất hiện ≥ 2 lần được xếp trước âm Unihan; sửa tay trong
  `tools/converter/hanviet_overrides.json`.
- **Phiên bản:** Unicode 18.0.0 (Unihan.zip, SHA-256
  `4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e`).
- **Cách lấy lần sinh hiện tại (2026-11-26):** sandbox không tải trực tiếp được
  từ unicode.org (proxy chặn) nên dùng bản phân phối lại trong gói npm
  [`@mandel59/mojidata@1.9.3`](https://www.npmjs.com/package/@mandel59/mojidata)
  (`npm pack`, đọc bảng `unihan_each_*` trong `dist/moji.db`). Gói này khai báo
  giấy phép dữ liệu `Unicode-3.0` cho phần Unihan và kèm nguyên văn giấy phép ở
  `licenses/unicode.txt`; nguồn gốc và checksum được ghim trong `download.txt`
  của gói (trỏ về `https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip`).
- **Sinh lại từ nguồn gốc:** tải
  `https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip` rồi chạy
  `python tools/build_hanviet.py --unihan <đường-dẫn>/Unihan.zip`.
- **Giấy phép:** Unicode License v3 — nguyên văn dưới đây (đã đối chiếu với
  https://www.unicode.org/license.txt ngày 2026-11-26, trùng khớp).

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

Phần âm suy từ glossary và `hanviet_overrides.json` là dữ liệu của dự án
HacDaoTruyen (không phải dữ liệu Unicode).
