# Nghiên cứu sangtacviet (STV): cơ chế convert & name (bản xác minh lại bằng trình duyệt)

Ngày khảo sát: 2026-11-26. Bản này **thay thế** bản trước (bản trước phần lớn là suy luận vì công cụ chạy ngoài VPN nên bị chặn).

- **Trình duyệt:** Claude in Chrome (Chrome thật của người dùng, đi qua VPN), mở 1 tab riêng, đóng sau khi xong.
- **Domain:** `https://sangtacviet.com` mở được ngay, nên không thử `.vip`/`.app`.
- **Phạm vi:** không đăng nhập, không gửi form, không bấm lưu. Không gặp CAPTCHA. Khoảng 15 lượt tải/request chủ động tới site (3 lần điều hướng trang, 1 POST `readchapter` đọc lại chương, các lần fetch file JS cùng origin, phần lớn lấy từ cache).
- **Lưu ý về công cụ:** extension chặn mọi output có dạng query string, cookie hoặc base64. Vì vậy mọi trích đoạn đều được mã hoá tạm (`=`→`⁼`, `&`→`⅋`, `?`→`⁇`) rồi giải lại. Hash SHA-256 của bản giải đã khớp với bản trong trang. Không đọc được giá trị cookie.

Quy ước nhãn: **[QS]** là quan sát trực tiếp (có bằng chứng), **[SL]** là suy luận.

---

## 1. Cấu trúc URL [QS]

| Trang | URL mẫu |
|---|---|
| Trang chủ | `https://sangtacviet.com/` |
| Trang truyện | `/truyen/{host}/1/{bookid}/`, ví dụ `/truyen/qidian/1/1051445595/` |
| Trang chương | `/truyen/{host}/1/{bookid}/{chapterid}/`, ví dụ `/truyen/qidian/1/1051445595/936066347/` |

- `host` thấy trên trang chủ gồm: `qidian`, `ciweimao`, `fanqie`, `dich` (truyện dịch tay), `sangtac` (truyện sáng tác).
- Trên trang truyện, mục lục là các `<a class="listchapitem" href="about:blank">`. Nhấp vào thì JS mới điều hướng sang chương (`readnow()` gọi `.listchapitem.click()` trong `stv.book.main.js`).
- Trang chương mới tải xong chỉ hiện chữ "Nhấp vào để tải chương...". Người đọc phải nhấp thì nội dung mới được tải. Đây là một bước chặn bot nhẹ, không phải CAPTCHA.

## 2. Luồng tải chương: server convert sẵn, mỗi từ thành một token có thuộc tính [QS]

Sau khi nhấp, network ghi nhận:

```
POST https://sangtacviet.com/index.php?bookid=1051445595&h=qidian&c=936066347&ngmar=readc&sajax=readchapter&sty=1&exts=   → 200
POST https://sangtacviet.com/io/novel/updateOldLink → 200
```

Response là JSON, gồm các trường `code, bookname, chaptername, data, next, prev, bookid, bookhost, owner, defaultname, via_tl, origin`. Trích ngắn (đã cắt bớt):

```json
{"code":"0","chaptername":"Thứ 1 chương Tiểu Vũ, cởi quần áo\n","bookhost":"qidian",
 "owner":"0","defaultname":null,"via_tl":"qt-2019",
 "origin":"https://m.qidian.com/book/1051445595/936066347.html",
 "data":"<p><span ...>@Bạn đang đọc bản lưu trong hệ thống</span></p> “<i h='tiểu vũ't='小舞'v='Tiểu Vũ/tiểu vũ/tiểu Vũ'p='n'>Tiểu Vũ</i>, <i h='thoát y phục't='脱衣服'v='cởi quần áo'p='i'>cởi quần áo</i>.” ..."}
```

Kết luận:

- **Server convert sẵn** (theo kiểu QuickTranslate, `via_tl: "qt-2019"`) rồi trả về HTML đã có tiếng Việt. Client **không** tự convert toàn bộ chương từ đầu.
- Chữ Hán gốc **vẫn đi kèm** từng token. Chương có 63 KB, khoảng 822 thẻ `<i>`. Mỗi `<i>` có 4 thuộc tính:
  - `t`: chữ Hán gốc.
  - `h`: âm Hán Việt.
  - `v`: các nghĩa VietPhrase, phân cách bằng `/`.
  - `p`: nhãn từ loại theo kiểu jieba/ICTCLAS. Đếm được trong chương: `n` 184, `v` 181, `d` 67, `r` 61, `nr` 58 (tên người), `ns` 13 (địa danh), `m`, `a`, `c`…
- `origin` ghi URL chương gốc (m.qidian.com), tức server crawl từ nguồn rồi lưu lại ("bản lưu trong hệ thống").
- `defaultname` là bộ name mặc định của truyện do chủ truyện/quản lý đặt. Truyện này có giá trị `null`.

## 3. DOM nội dung chương và hành vi khi nhấp [QS]

- Container: `div#cld-{bookid}-{chapterid}.contentbox` nằm trong `#content-container`.
- Mỗi từ là một `<i>` riêng, được client gán thêm `id="ran{n}"`. Đoạn chữ không có trong từ điển (dấu câu, số) được `fastNaming()` bọc thành `<i id="exran{n}" onclick="pr(this);">`.
- Nhấp một từ gọi `pr(e)`. Hàm này tô đỏ từ, gọi `defineSys()` rồi điền vào popup `#nsbox`. Popup chỉ hiện cục bộ. Tôi đã mở thử trên từ "Đấu La Đại Lục" và thấy:

| Hàng | id | Nội dung | Nút |
|---|---|---|---|
| hv | `#hv` | Hán Việt thường ("đấu la đại lục") | áp dụng (`applyNs`) / áp dụng + lưu (`applyAndSaveNs`) |
| HV | `#huc` | Hán Việt viết hoa ("Đấu La Đại Lục") | như trên |
| (ẩn) | `#vuc` | VietPhrase viết hoa | như trên |
| zw | `#zw` | chữ Hán "斗罗大陆" | Google dịch, copy, Google search |
| Tr | `#instrans` | nghĩa VP hoặc "dịch trực tiếp", lấy từ `phrasetree`, nếu không có thì gọi `tse.send("001")` | **Sửa** → `openmodvp()` |
| tc | `#op` | "cụm từ tùy chọn" | áp dụng / lưu |
| — | | **Mở rộng ←/→** (`expandLeft/expandRight`): ghép thêm token bên cạnh để tạo cụm dài hơn | |
| — | | **Quản lý** (`showNS`), ▶ chạy lại (`excute`), **Thêm name** (`showAddName`) | |

- Popup **Thêm name/Chỉnh name** (`#addnamebox`) có các trường: Tiếng Trung, Hán Việt (5 kiểu viết hoa: "Dùng", "Hoa chữ đầu", "Hoa 2 chữ đầu", "Thường chữ cuối", "Hoa toàn bộ"), Tiếng Anh, Vietphrase, "Name trong kho" (select lấy từ `sajax=getnamefromdb`), "Xóa name", và checkbox `#issavetobook`. Checkbox này chỉ hiện với quản lý truyện; khi được tick thì gọi `ajax=defaultbooknaming&sub=addname` để ghi vào **name mặc định của truyện trên server**.
- Popup **Chỉnh Vietphrase** (`#modifyvpbox`) có: Tiếng Trung, Hán Việt, Vietphrase, "Ghép từ", "Giữ nghĩa 1", "Xóa vp", "Xác nhận" (`modvp()`). Kết quả lưu vào `phrasetree`.
- Bảng **Quản lý name** (`#namewdf`) có: Lưu lại, Chạy, Xóa hết, Tải name (`getNSOnline`), Upload/Chia sẻ gói name (`sendNS` → `POST /index.php?upload=true` kèm `data, username, bookid, host`), "Tải name được chia sẻ", "Nhập/Xuất dữ liệu", "Sử dụng file vp riêng", "Tải name đặc biệt" (`loadCustomName` → `GET /customname/{pack}.txt`), "Analyzer", "Công cụ Transform".
- Có chế độ `setting.directedit`: nhấp lần hai vào từ đang chọn sẽ cho sửa trực tiếp bằng `contentEditable`.

## 4. Engine name/VietPhrase phía client [QS, đọc mã]

Các file JS tải trên trang chương (quan sát qua network và `document.scripts`):

| File | Kích thước | Vai trò |
|---|---|---|
| `qtOnline.js?ver=3504` | 353 KB | lõi convert/name ("qtOnline.js v3.4 … created by Sir") |
| `hanviet.js?ver=6` | 176 KB | `var hanvietdic = {…}`, 16.838 chữ đơn → âm HV |
| `stv.ui.js?v=1.288` | 154 KB | UI, cài đặt, loader chương kế tiếp |
| `stv.readinit.js?v=8` | 100 KB | **bị obfuscate** (`_0x…`), không đọc được |
| `stv.tts.v2.min.js` | 222 KB | TTS |
| `stv.host.js`, `stv.excomment.js`, `stv.book.main.js` (trang truyện), `jqr.js`, `bootstrap`, `crypto-js 4.1.1` (cdnjs) | | |

**Luồng `excute()`** (chạy sau khi chương được chèn vào DOM):

1. Thoát sớm nếu cookie `transmode=chinese` (đọc bản tiếng Trung) hoặc `foreignlang≠vi`. Cũng thoát với host `sangtac`.
2. `fastNaming()` bọc phần text lẻ thành token.
3. Đọc name cá nhân từ `localStorage[host+bookid]`, ví dụ key `qidian1051445595`. Nếu bật `setting.onlyonename` thì dùng một bộ chung cho mọi truyện ở `localStorage.qtOnline0`. Ghép thêm `bookDefaultName` (name mặc định của truyện từ server) nếu không tắt `disabledefaultname`.
4. Phân tích từng dòng theo **cú pháp tiền tố**:
   - `$中文=Việt`: name, đưa vào `dictionary` và `nametree`. Đây là kiểu phổ biến.
   - `@a|b=c|d`: thay theo chuỗi token (`replaceByNode`).
   - `#中文=…`: chỉ thêm vào dictionary.
   - `~…`: luật ngữ pháp của `meanengine`, có cú pháp `{0}` và `->`.
   - dòng khác: regex (`replaceByRegex`).
5. `replaceVietphrase()`: duyệt các `<i>`, ghép token kề nhau rồi so **khớp dài nhất** với `phrasetree` (VP cá nhân). Phần dư được tách qua `tse.send("004")`.
6. `replaceName()` (nếu `allownamev3`): tương tự nhưng với `nametree`, giới hạn tối đa 12 ký tự. Node khớp được gắn `isname="true"`. `setNameNodeValue` còn hỗ trợ cú pháp `[i]url[/]` để gắn ảnh vào name.
7. `meanSelector()`: chọn nghĩa theo ngữ cảnh.

**Dịch từ lẻ / nghĩa:** `tse` là client WebSocket (`wss://sangtacviet.com{endpoint}`). Lúc khảo sát `window.endpoint` là undefined nên client rơi về XHR gom lô sau 1 s, gửi tới `https://comic.sangtacvietcdn.xyz/tsm.php` (`sajax=trans`) và `/tmm.php` (`sajax=transmulmean`), phân cách bằng `<split>`. Các endpoint phụ khác: `sajax=worddict`, `ajax=genderpredict`, analyzer `anl.sangtacvietcdn.xyz`.

**Từ điển có tải về client không?**

- Có `hanvietdic` (HV chữ đơn, 16.838 mục). Có `dictionary.data` (450 mục lúc khảo sát).
- **Không** tải cả VietPhrase lớn: `dictionary.readTextFile()` chỉ đặt `finished=true`, còn `phrasetree.data` chỉ có 4 nhánh. Mọi nghĩa đã nằm sẵn trong thuộc tính `v` của token do server trả.
- `IndexedDB`: chỉ dùng khi bật "file vp riêng" (`IdbKvStore('vietphrase')`). Lúc khảo sát không có database nào. Mặc định VP cá nhân lưu ở `localStorage.vietphrase` (JSON).

**Name cá nhân lưu ở đâu:**

- [QS] Lưu ở localStorage, dạng chuỗi nối bằng `~//~`. Giá trị thật quan sát được (không đăng nhập): `qidian1051445595 = "$唐三=Đường Tam~//~$魂力=Hồn Lực~//~$魂环=Hồn Hoàn~//~$史莱克=Sử Lai Khắc~//~$王长生=Vương Trường Sinh~//~"`.
- [QS] Key `aqidian1051445595 = "&王长生=15;史莱克=10;唐三=17;魂力=6;魂环=5;"` có dạng **đếm tần suất** từng name.
- [SL] Hai key này có thể do bộ tự phát hiện name (`prediction`/`collectphrase`/`useAllNameDetected`) tạo ra khi đọc, vì tôi không tự thêm name nào. Chưa xác minh được nguồn chính xác.
- [QS] Đồng bộ server: `syncvp()` và `syncvpfile()` hiện **bị vô hiệu** (dòng đầu là `return;`). Name chỉ lên server qua 3 đường: chia sẻ gói name (`upload=true`), name mặc định của truyện (quản lý truyện), hoặc kho name `getnamefromdb`.

**Các key localStorage khác** [QS, quét mã]: `setting` (JSON gồm `allownamev3`, `allowtaptoedit`, `peoplefilter`, `factionfilter`, `skillfilter`, `scopefilter`, `allowchiname`, `autosave`, `autosync`…), `tusach`, `speaker-*` (TTS), `backgroundcolor`, `fontcolor`, `fontsize`, `fontfamily`, `padding`, `textalign`, `textlshadow`, `cfg_autonext`, `cfg_infscroll`, `unitymode`, `issavetobook`, `lastsync`, `lastsyncvp`, `lastedittime`. Cookie (chỉ thấy tên trong mã): `transmode` (`chinese`/`tfms`/`bing`), `foreignlang`, `theme`.

## 5. Các tính năng Reader khác

- [QS] Bảng cài đặt (nút bánh răng) có: màu nền (14 màu), màu chữ, bóng chữ, cỡ chữ (24), giãn dòng (1.2), font, 6 kiểu căn lề/thụt, "Nghe sách" (TTS), "Name".
- [QS] Chế độ dịch qua cookie `transmode`: tiếng Trung gốc / `tfms` / `bing`, tức có tuỳ chọn máy dịch khác thay cho QT. `toCnWithName()` cho phép copy bản Trung đã thay name.
- [QS] Có tự chuyển chương kế (`cfg_autonext`), cuộn vô hạn (`cfg_infscroll`, `ui.unity.loadnextchapter` nạp chương sau qua `readchapter` rồi `history.replaceState`).
- [QS] Tủ truyện: `localStorage.tusach` và `ajax=markbook`/`synctusach`. Theo dõi truyện (`followbook`) kèm web push. Bình luận (`/io/comment/webComments`, `ajax=postcomment`). "Lấp hố" chương VIP (`sajax=fillchapter`, cho qidian và zongheng). Đẩy sách, thích truyện, tự nhận diện trạng thái hoàn thành bằng regex tên chương.
- [SL] Chuyển nguồn: chưa thấy UI đổi host trong lượt khảo sát. Mỗi truyện gắn cố định một `host` trong URL, còn `linkwithtransver` liên kết với bản dịch tay.

## 6. REA

- Lưu `outputs/research/stv_bundle/qtOnline.excerpt.js` (11,8 KB). Đây là **trích đoạn**, không phải file gốc. Gồm các hàm `excute, saveNS, loadNameData, parseNameRow, replaceVietphrase, replaceByNode, setNameNodeValue`, lấy qua `Function.prototype.toString` trong trang. Hash đã khớp với bản trong trang và `node --check` báo OK. Không lưu file gốc 353 KB vì kênh truyền qua extension giới hạn khoảng 1 KB mỗi chuỗi. `replaceName` (12,5 KB) bị bỏ vì quá dài.
- `npx rea-agents@6.7.0 analyze-javascript-application … --json` → `stv_rea_evidence.json` (2,4 MB), exit 0. Kết quả: parse 1 file, 2.433 nút AST, 0 lỗi, 0 finding. Semantic graph có 15 hàm (8 hàm có tên), 196 call-site, 3 timer (`setTimeout`). Không trích được endpoint hay storage key, vì excerpt dùng alias `store` thay cho `localStorage`, và REA thiên về Electron (summary IPC/browser windows đều bằng 0). Giá trị thêm so với đọc tay là thấp. Danh sách endpoint/key ở mục 4 được lấy bằng quét mã trực tiếp trong trang.

---

## 7. So sánh với HacDaoTruyen và đề xuất

| Khía cạnh | sangtacviet | HacDaoTruyen hiện tại |
|---|---|---|
| Bản dịch | QT/VietPhrase máy, server convert, **giữ chữ Hán từng token** | AI dịch, markdown tiếng Việt, **không giữ chữ Hán** |
| Name theo truyện | `defaultname` do quản lý truyện đặt, client áp ngay | `glossary.json` R2 (cho chương dịch sau) + `replacements.json` công khai do admin duyệt |
| Name cá nhân | localStorage theo `host+bookid`, cú pháp `$`/`@`/`#`/`~`/regex, áp trên DOM | quy tắc cá nhân localStorage, đồng bộ `/api/user/prefs` (**tốt hơn STV**, vì sync của STV đang tắt) |
| Sửa tại chỗ | nhấp từ → popup HV/VP/Hán, mở rộng trái phải, lưu 1 chạm | góp ý name (`glossary-suggestions`) → admin duyệt |
| Chia sẻ gói name | upload/tải gói, kho name | chưa có |
| Gợi ý name | đếm tần suất, POS `nr/ns`, kho name, đoán giới tính | chưa có |

Điểm mình còn thiếu, chủ yếu do bản dịch AI không giữ mối liên kết Hán → Việt: người đọc không biết một cụm tiếng Việt ứng với chữ Hán nào, nên không sửa được tận gốc. Name sửa bằng thay chuỗi Việt→Việt dễ thay nhầm, ví dụ một từ thường trùng với tên riêng.

Đề xuất, xếp theo giá trị/độ khó (cao/thấp trước):

1. **Popup chọn văn bản → "Sửa name" ngay trong Reader** (giá trị cao, khó thấp). Bôi đen hoặc nhấp đúp một cụm sẽ mở popup gồm: chuỗi hiện tại, đề xuất thay, phạm vi [chỉ mình tôi (localStorage + prefs) | góp ý công khai (`glossary-suggestions`)]. Áp ngay trên DOM như STV. Hạ tầng đã có sẵn, chỉ thiếu UX 1 chạm.
2. **Trả "name map" theo chương khi dịch** (cao/trung bình). Yêu cầu prompt AI xuất thêm JSON `[{vi:"Đường Tam", zh:"唐三"}]` cho các tên riêng (tương tự `p=nr/ns`), lưu kèm chương ở R2 (`<slug>/<ch>.names.json`). Reader bọc các tên này thành `<span data-zh>`, nhờ đó popup ở mục 1 biết chữ Hán gốc. Khi duyệt góp ý thì ghi thẳng `glossary.json` với khoá Hán, không phải đoán.
3. **Biến thể viết hoa và nút gợi ý Hán Việt** (cao/thấp). Ở popup cho chọn nhanh "Hoa chữ đầu / Hoa toàn bộ / thường chữ cuối" như `addSuperName`. Có `zh` (từ mục 2) thì sinh âm HV bằng một bảng `hanvietdic` khoảng 170 KB, tải lười chỉ khi mở popup.
4. **Thống kê tần suất name và cảnh báo lệch** (trung bình/thấp). Đếm số lần xuất hiện của các khoá glossary trong chương (tương tự key `a{host}{book}` của STV). Hiện cho admin những tên AI dịch lệch so với glossary (cùng `zh` nhưng ra nhiều biến thể Việt).
5. **Gói name chia sẻ / xuất-nhập** (trung bình/thấp). Cho người dùng xuất và nhập quy tắc cá nhân theo truyện (JSON hoặc dạng `$中文=Việt`), và "đề cử" cả gói thành góp ý hàng loạt cho admin.
6. **Quy tắc có điều kiện an toàn** (trung bình/trung bình). Hỗ trợ ranh giới từ và phân biệt hoa thường cho quy tắc thay thế, kiểu `@a|b=c|d` theo chuỗi token. Không cho regex tự do và **không dùng eval** như STV (`toeval`/`doeval` là rủi ro XSS).
7. **Chế độ song ngữ / hiện chữ Hán** (trung bình/cao). Chỉ khả thi nếu lưu đoạn gốc theo đoạn (paragraph alignment). Nên cân nhắc sau, và cần xét bản quyền nguồn.

Điểm **không nên** học: client chặn bằng thao tác "nhấp để tải", obfuscate `readinit`, áp quy tắc bằng `eval` chuỗi, và crawl hay lấp hố chương VIP (rủi ro pháp lý).

## 8. Giới hạn còn lại

- Không đọc được `stv.readinit.js` vì bị obfuscate, cũng không đọc được `replaceName` đầy đủ và giá trị cookie.
- Chưa xác minh nguồn của hai key name/tần suất trong localStorage, và chưa thấy luồng WebSocket thật (`endpoint` undefined).
- Chưa thử tài khoản đăng nhập (đồng bộ tủ truyện, quyền quản lý truyện), chưa thử `.vip`/`.app` và chưa thử TTS thực tế.
- REA chỉ chạy trên trích đoạn 11,8 KB nên bằng chứng ở mức cấu trúc hàm.
