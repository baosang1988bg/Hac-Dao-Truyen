"""E2E THẬT cho đợt "học từ đối thủ" (nhánh feature/competitor-learnings).

Dựng `wrangler dev --local` (D1/R2 giả lập trong thư mục persist tạm) + backend
admin giả (http.server) rồi chạy Chromium headless (Playwright) qua 8 kịch bản:
  1. Trang chủ: không lỗi JS, "Đọc nhiều" Ngày/Tuần/Tháng trống hợp lý, /?q=
  2. Trang truyện: JSON-LD Book trong HTML thô, chấm sao khách, reload giữ sao
  3. Lượt đọc thật: read-start → cuộn cuối → ≥30s → /view counted:true → D1
  4. Tiến độ theo đoạn: reload về đúng đoạn; đăng nhập → PUT paragraph → D1 N#pM
  5. Hộp sửa name: chữ Hán, viết hoa, mở rộng cụm, quy tắc cá nhân, góp ý →
     admin duyệt → /replacements + glossary R2 → khách mới thấy quy tắc công khai
  6. Đồng bộ cài đặt đọc giữa 2 context cùng token
  7. Nền theo theme ngay lúc DOMContentLoaded (không nháy #0f172a)
  8. Xuất/nhập gói name trong ReplacementsManagerModal
  9. Nhiều bản dịch: đọc ?ban= giữ đoạn "N#pM" của bản mặc định (keep_paragraph),
     lịch sử + hd:ban nhớ bản dịch → "Đọc tiếp" mang ?ban=; admin /admin/editions
     ẩn bản dịch → D1 published/edition_count + API công khai cập nhật ngay

KHÔNG gọi Cloudflare thật (mọi lệnh wrangler đều --local + --persist-to tạm).

Chạy (sandbox Linux, cần bản sao có node_modules — xem docstring cuối file):
  export LD_LIBRARY_PATH=$HOME/stublib
  HD_DIR=/tmp/hd python3 tests/browser/e2e_engagement.py
Biến môi trường: HD_DIR (thư mục có node_modules wrangler + frontend/dist),
E2E_OUT (thư mục ảnh chụp lỗi), E2E_KEEP=1 (giữ thư mục persist để soi).
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

HD_DIR = Path(os.environ.get('HD_DIR', '/tmp/hd'))
OUT_DIR = Path(os.environ.get('E2E_OUT', str(Path(tempfile.gettempdir()) / 'hacdao-e2e')))
SLUG = 'e2e-ha-than'
TITLE = 'Hạ Thần Truyền Kỳ'
ADMIN_TOKEN = 'admin-e2e'
USER_TOKEN = 'u_' + 'ab' * 32
USER_INFO = {'id': 1, 'email': 'e2e@example.com', 'name': 'Người Đọc E2E'}
N_PARAGRAPHS = 60
EDITION = 'nhom-e2e'

ENV = dict(os.environ, WRANGLER_SEND_METRICS='false', CI='1',
           NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost')
for k in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'):
    ENV.pop(k, None)

RESULTS = []  # (mục, PASS/FAIL, chi tiết)


def record(item, ok, detail=''):
    RESULTS.append((item, 'PASS' if ok else 'FAIL', detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {item} {detail}", flush=True)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def run(cmd, **kw):
    res = subprocess.run(cmd, cwd=HD_DIR, env=ENV, capture_output=True, text=True, timeout=180, **kw)
    if res.returncode != 0:
        raise RuntimeError(f"Lệnh lỗi: {' '.join(cmd)}\n{res.stdout[-2000:]}\n{res.stderr[-2000:]}")
    return res.stdout


def wrangler(*args):
    return run(['npx', 'wrangler', *args])


# ── Dữ liệu seed ─────────────────────────────────────────────────────────────
def chapter_markdown(n):
    lines = [f'# Chương {n}: Hồi thứ {n}', '']
    for i in range(N_PARAGRAPHS):
        lines.append(
            f'Đoạn số {i}. Hạ Thần đại nhân đứng trên đỉnh núi, nhìn Lâm Phong từ xa. '
            'Gió lạnh thổi qua, mây đen kéo tới, cả thiên địa như chìm vào im lặng. '
            'Hắn biết trận chiến này sẽ quyết định vận mệnh của cả tông môn, không thể lùi bước.'
        )
        lines.append('')
    return '\n'.join(lines)


def seed(persist):
    tmp = Path(tempfile.mkdtemp(prefix='e2e-seed-'))
    sql = [
        f"INSERT INTO novels (slug, title, original_title, author, genre, status, synopsis, published, "
        f"total_chapters, chapter_count, updated_at) VALUES ('{SLUG}', '{TITLE}', '夏辰传奇', 'Tác Giả E2E', "
        f"'Tiên hiệp', 'ongoing', 'Truyện thử nghiệm E2E về Hạ Thần và Lâm Phong.', 1, 3, 3, datetime('now'));",
        "INSERT INTO users (id, email, name, password_hash) VALUES (1, 'e2e@example.com', 'Người Đọc E2E', '');",
        f"INSERT INTO user_sessions (token, user_id, expires_at) VALUES ('{USER_TOKEN}', 1, '2099-01-01 00:00:00');",
    ]
    for n in (1, 2, 3):
        fn = f'{n:04d}_VI.md'
        sql.append(
            f"INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key) "
            f"VALUES ('{SLUG}', '{fn}', 'Chương {n}: Hồi thứ {n}', {n}, '{SLUG}/{fn}');"
        )
        p = tmp / fn
        p.write_text(chapter_markdown(n), encoding='utf-8')
        wrangler('r2', 'object', 'put', f'hacdao-chapters/{SLUG}/{fn}', '--local', '--persist-to', str(persist),
                 '--file', str(p), '--content-type', 'text/markdown; charset=utf-8')
    # Bản dịch phụ (migration 016 đã có trong schema.sql): 2 chương, đang published.
    sql.append(
        f"INSERT INTO editions (id, novel_slug, code, name, translator, kind, license_note, published, chapter_count) "
        f"VALUES (1, '{SLUG}', '{EDITION}', 'Bản dịch nhóm E2E', 'Nhóm E2E', 'human', "
        f"'Nhóm E2E đồng ý cho đăng (thư 2026-11-26)', 1, 2);"
    )
    sql.append(f"UPDATE novels SET edition_count = 1 WHERE slug = '{SLUG}';")
    for n in (1, 2):
        key = f'{SLUG}/ed/{EDITION}/content/e2e{n}.md'
        sql.append(
            f"INSERT INTO edition_chapters (edition_id, filename, title, chapter_number, r2_key) "
            f"VALUES (1, 'E{n}_VI.md', 'Chương {n}: Bản nhóm', {n}, '{key}');"
        )
        p = tmp / f'ed{n}.md'
        p.write_text(f'# Chương {n}: Bản nhóm\n\n' + '\n\n'.join(
            f'Bản nhóm E2E đoạn {i}. Hạ Thần nhìn về phía chân trời.' for i in range(30)), encoding='utf-8')
        wrangler('r2', 'object', 'put', f'hacdao-chapters/{key}', '--local', '--persist-to', str(persist),
                 '--file', str(p), '--content-type', 'text/markdown; charset=utf-8')
    g = tmp / 'glossary.json'
    g.write_text(json.dumps({'夏辰': 'Hạ Thần', '林风': 'Lâm Phong', '宗门': 'tông môn'}, ensure_ascii=False), encoding='utf-8')
    wrangler('r2', 'object', 'put', f'hacdao-chapters/{SLUG}/glossary.json', '--local', '--persist-to', str(persist),
             '--file', str(g), '--content-type', 'application/json')
    wrangler('d1', 'execute', 'hacdao-db', '--local', '--persist-to', str(persist), f'--file={HD_DIR / "schema.sql"}')
    s = tmp / 'seed.sql'
    s.write_text('\n'.join(sql), encoding='utf-8')
    wrangler('d1', 'execute', 'hacdao-db', '--local', '--persist-to', str(persist), f'--file={s}')
    shutil.rmtree(tmp, ignore_errors=True)


def d1_query(persist, sql):
    out = wrangler('d1', 'execute', 'hacdao-db', '--local', '--persist-to', str(persist), '--json', '--command', sql)
    m = out[out.find('['):]
    data = json.loads(m)
    return data[0].get('results', []) if data else []


def r2_get_json(persist, key):
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'obj.json'
        wrangler('r2', 'object', 'get', f'hacdao-chapters/{key}', '--local', '--persist-to', str(persist), '--file', str(f))
        return json.loads(f.read_text(encoding='utf-8'))


# ── Backend admin giả ────────────────────────────────────────────────────────
class FakeBackend(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/api/auth/verify'):
            if self.headers.get('Authorization') == f'Bearer {ADMIN_TOKEN}':
                return self._send(200, {'valid': True, 'role': 'admin', 'username': 'admin'})
            return self._send(401, {'detail': 'Unauthorized'})
        return self._send(404, {'detail': 'Not found'})

    do_POST = do_GET


# ── Tiện ích Playwright ──────────────────────────────────────────────────────
class PageWatch:
    """Gom pageerror + console error + request/response API của 1 page."""

    IGNORED_CONSOLE = (
        'Failed to load resource',  # tài nguyên ngoài (font, GA) bị chặn có chủ đích
        'googletagmanager', 'fonts.g',
    )

    def __init__(self, page, name):
        self.name = name
        self.errors = []
        self.api = []  # (method, path, status, req_body, resp_json)
        page.on('pageerror', lambda e: self.errors.append(f'pageerror: {e}'))
        page.on('console', self._console)
        page.on('response', self._response)

    def _console(self, msg):
        if msg.type == 'error' and not any(s in msg.text for s in self.IGNORED_CONSOLE):
            self.errors.append(f'console: {msg.text[:300]}')

    def _response(self, resp):
        url = resp.url
        if '/api/' not in url:
            return
        path = url.split('://', 1)[1].split('/', 1)[1]
        body = None
        try:
            if 'json' in (resp.headers.get('content-type') or ''):
                body = resp.json()
        except Exception:
            body = None
        try:
            req_body = resp.request.post_data
        except Exception:
            req_body = None
        self.api.append((resp.request.method, '/' + path, resp.status, req_body, body))

    def find(self, method, needle, since=0):
        return [a for a in self.api[since:] if a[0] == method and needle in a[1]]


def new_context(browser, base, storage=None, init_scripts=()):
    ctx = browser.new_context(base_url=base, service_workers='block', viewport={'width': 1280, 'height': 800},
                              accept_downloads=True, locale='vi-VN')

    def block_external(route):
        if route.request.url.startswith(base):
            return route.continue_()
        ctype = 'text/css' if 'fonts' in route.request.url else 'text/plain'
        return route.fulfill(status=200, body='', content_type=ctype)

    ctx.route('**/*', block_external)
    if storage:
        js = ''.join(f'localStorage.setItem({json.dumps(k)}, {json.dumps(v)});' for k, v in storage.items())
        # Chỉ đặt lần đầu (cờ trong sessionStorage) — reload không ghi đè thay đổi của app.
        ctx.add_init_script(f"try{{ if(!sessionStorage.getItem('__e2e_seeded')){{ {js} sessionStorage.setItem('__e2e_seeded','1') }} }}catch(e){{}}")
    for s in init_scripts:
        ctx.add_init_script(s)
    return ctx


def shot(page, name):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / f'{name}.png'
    try:
        page.screenshot(path=str(p), full_page=False)
    except Exception:
        pass
    return p


def wait_for(page, fn, timeout=10.0, step=0.25):
    """Chờ fn() truthy. PHẢI ngủ bằng page.wait_for_timeout: API sync của Playwright
    chỉ xử lý sự kiện (response, console...) khi đang trong một lời gọi Playwright."""
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        page.wait_for_timeout(int(step * 1000))
    return last


def first_visible_paragraph(page):
    return page.evaluate("""() => {
      const ps = [...document.querySelectorAll('.reader-p')];
      const i = ps.findIndex(p => p.getBoundingClientRect().bottom > 8);
      if (i < 0) return null;
      const m = (ps[i].textContent || '').match(/(?:Đoạn|Phần) số (\\d+)/);
      return { index: i, marker: m ? Number(m[1]) : null };
    }""")


def select_text_in_reader(page, needle):
    """Bôi đen `needle` trong đoạn văn đầu tiên chứa nó + bắn mouseup như người dùng."""
    return page.evaluate("""(needle) => {
      const p = [...document.querySelectorAll('.reader-p')].find(el => (el.textContent || '').includes(needle));
      if (!p) return false;
      p.scrollIntoView({ block: 'center' });
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.data.indexOf(needle);
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(node, i); r.setEnd(node, i + needle.length);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          const rect = r.getBoundingClientRect();
          p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 2 }));
          return true;
        }
      }
      return false;
    }""", needle)


def reader_text(page):
    return page.locator('.reader-content').inner_text()


def wait_reader(page):
    page.wait_for_selector('.reader-p', timeout=20000)


def set_range(page, label, value):
    page.evaluate("""([label, value]) => {
      const el = document.querySelector(`input[type=range][aria-label="${label}"]`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }""", [label, value])


def check(item, fn, page=None):
    try:
        fn()
    except Exception as e:
        record(item, False, f'{type(e).__name__}: {e}')
        traceback.print_exc()
        if page is not None:
            shot(page, re.sub(r'\W+', '_', item)[:60])


class Fail(Exception):
    pass


def expect(cond, msg):
    if not cond:
        raise Fail(msg)


# ── Kịch bản ────────────────────────────────────────────────────────────────
def scenario(base, persist):
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--no-proxy-server'])
        logged_in = {'userToken': USER_TOKEN, 'userInfo': json.dumps(USER_INFO)}

        # 1 ── Trang chủ
        ctx = new_context(browser, base)
        page = ctx.new_page()
        w = PageWatch(page, 'home')

        def t1():
            page.goto('/', wait_until='networkidle')
            page.mouse.wheel(0, 2000)
            page.get_by_text('Đọc nhiều', exact=True).first.scroll_into_view_if_needed(timeout=15000)
            empty = 'Chưa có đủ dữ liệu lượt đọc cho kỳ này'
            for label in ('Ngày', 'Tuần', 'Tháng'):
                btn = page.locator('button.qidian-rank-tab', has_text=re.compile(f'^{label}$'))
                btn.first.click()
                page.get_by_text(empty).first.wait_for(timeout=8000)
                expect(btn.first.get_attribute('aria-pressed') == 'true', f'tab {label} không active')
            expect(len(w.find('GET', '/api/rankings/views')) >= 3, 'không gọi đủ /api/rankings/views cho 3 kỳ')
            page.goto('/?q=' + urllib.request.quote('Hạ Thần'), wait_until='networkidle')
            box = page.locator('input[aria-label="Tìm kiếm truyện hoặc EPUB"]').first
            expect(box.input_value() == 'Hạ Thần', f'ô tìm = {box.input_value()!r}')
            page.locator(f'a[href="/novel/{SLUG}"]').first.wait_for(timeout=8000)
            expect(not w.errors, 'lỗi JS: ' + ' | '.join(w.errors[:3]))
            record('1. Trang chủ + Đọc nhiều + ?q=', True, f'({len(w.api)} API, 0 lỗi JS)')
        check('1. Trang chủ + Đọc nhiều + ?q=', t1, page)
        ctx.close()

        # 2 ── Trang truyện
        ctx = new_context(browser, base)
        page = ctx.new_page()
        w = PageWatch(page, 'novel')

        def t2():
            raw = urllib.request.urlopen(f'{base}/novel/{SLUG}', timeout=15).read().decode('utf-8')
            blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', raw, re.S)
            types = []
            for b in blocks:
                try:
                    d = json.loads(b)
                    for x in (d if isinstance(d, list) else [d]):
                        types.append(x.get('@type'))
                except Exception:
                    pass
            expect('Book' in types, f'không thấy JSON-LD Book (các @type: {types})')
            page.goto(f'/novel/{SLUG}', wait_until='networkidle')
            star = page.locator('button[aria-label="Chấm 4 sao"]')
            star.click()
            rate = wait_for(page, lambda: w.find('POST', '/rate'), 8)
            expect(rate and rate[0][2] == 200, f'POST /rate: {rate}')
            expect(rate[0][4].get('rating') == 4 and rate[0][4].get('rating_count') == 1, f'body {rate[0][4]}')
            page.locator('.novel-rating__summary', has_text='4.0').wait_for(timeout=5000)
            page.reload(wait_until='networkidle')
            star = page.locator('button[aria-label="Chấm 4 sao"]')
            expect(star.get_attribute('aria-checked') == 'true', 'reload mất sao đã chấm')
            expect('is-on' in (star.get_attribute('class') or ''), 'sao không được tô')
            expect(not w.errors, 'lỗi JS: ' + ' | '.join(w.errors[:3]))
            record('2. JSON-LD Book + chấm sao khách', True, f'(@type: {types})')
        check('2. JSON-LD Book + chấm sao khách', t2, page)
        ctx.close()

        # 3 ── Lượt đọc thật (chờ THẬT ≥ 30 giây — server kiểm tuổi token theo giờ thật)
        ctx = new_context(browser, base)
        page = ctx.new_page()
        w = PageWatch(page, 'reader-guest')

        def t3():
            page.goto(f'/novel/{SLUG}/read/1')
            wait_reader(page)
            rs = wait_for(page, lambda: w.find('POST', '/read-start'), 10)
            expect(rs and rs[0][2] == 200 and rs[0][4].get('token'), f'read-start: {rs}')
            t0 = time.time()
            for _ in range(6):
                page.mouse.wheel(0, 4000)
                page.wait_for_timeout(300)
            page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
            view = wait_for(page, lambda: w.find('POST', '/view'), 50, 0.5)
            dt = time.time() - t0
            expect(view, 'không có POST /view sau 50s')
            method, path, status, req_body, body = view[0]
            expect(status == 200 and body and body.get('counted') is True, f'/view: {status} {body}')
            expect(req_body and '"token"' in req_body, f'body /view thiếu token: {req_body}')
            expect(dt >= 25, f'/view gửi quá sớm ({dt:.1f}s)')
            rows = d1_query(persist, f"SELECT slug, day, views FROM novel_views_daily WHERE slug='{SLUG}'")
            expect(rows and rows[0]['views'] >= 1, f'D1 novel_views_daily: {rows}')
            rank = json.loads(urllib.request.urlopen(f'{base}/api/rankings/views?period=day&limit=7', timeout=10).read())
            in_rank = any(it.get('slug') == SLUG for it in rank.get('items', []))
            expect(not w.errors, 'lỗi JS: ' + ' | '.join(w.errors[:3]))
            record('3. Lượt đọc thật', True, f'(/view sau {dt:.0f}s, counted:true, D1 {rows}, BXH ngày có truyện: {in_rank})')
        check('3. Lượt đọc thật', t3, page)

        # 4a ── Tiến độ theo đoạn (khách, local)
        def t4a():
            page.goto(f'/novel/{SLUG}/read/2')
            wait_reader(page)
            page.wait_for_timeout(1000)
            page.evaluate("document.querySelectorAll('.reader-p')[25].scrollIntoView({block:'start'})")
            page.mouse.wheel(0, 30)
            page.wait_for_timeout(2000)
            before = first_visible_paragraph(page)
            page.reload()
            wait_reader(page)
            page.wait_for_timeout(2000)
            after = first_visible_paragraph(page)
            expect(before and after and before['index'] >= 20, f'trước={before} sau={after}')
            expect(abs(after['index'] - before['index']) <= 2, f'reload không về đoạn cũ: trước={before} sau={after}')
            record('4a. Tiến độ theo đoạn sau reload', True, f'(đoạn trước {before["index"]}, sau {after["index"]})')
        check('4a. Tiến độ theo đoạn sau reload', t4a, page)
        ctx.close()

        # 4b ── Đăng nhập: rời tab → PUT paragraph → D1 N#pM
        ctxA = new_context(browser, base, storage=logged_in)
        pageA = ctxA.new_page()
        wA = PageWatch(pageA, 'reader-userA')

        def t4b():
            pageA.goto(f'/novel/{SLUG}/read/3')
            wait_reader(pageA)
            wait_for(pageA, lambda: wA.find('PUT', '/api/user/progress/'), 8)
            pageA.wait_for_timeout(1000)
            n0 = len(wA.api)
            pageA.evaluate("document.querySelectorAll('.reader-p')[30].scrollIntoView({block:'start'})")
            pageA.mouse.wheel(0, 30)
            pageA.wait_for_timeout(2000)
            pageA.evaluate("""() => {
              Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
              document.dispatchEvent(new Event('visibilitychange'));
            }""")
            put = wait_for(pageA, lambda: wA.find('PUT', '/api/user/progress/', n0), 8)
            pageA.evaluate("""() => {
              Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
              document.dispatchEvent(new Event('visibilitychange'));
            }""")
            expect(put and put[0][2] == 200, f'PUT progress khi ẩn tab: {put}')
            body = json.loads(put[0][3])
            expect(isinstance(body.get('paragraph'), int), f'body thiếu paragraph: {body}')
            rows = d1_query(persist, f"SELECT position FROM reading_progress WHERE user_id=1 AND slug='{SLUG}'")
            expect(rows and re.fullmatch(r'3#p\d+', rows[0]['position'] or ''), f'D1 position: {rows}')
            record('4b. PUT progress có paragraph khi rời tab', True, f'(body {body}, D1 {rows[0]["position"]})')
        check('4b. PUT progress có paragraph khi rời tab', t4b, pageA)

        # 5 ── Hộp sửa name
        def t5_personal():
            pageA.goto(f'/novel/{SLUG}/read/1')
            wait_reader(pageA)
            pageA.wait_for_timeout(1000)
            # Hồi quy: InlineGlossaryModal/ReplacementsManagerModal từng luôn hiện (ui/Modal bỏ qua isOpen).
            expect(pageA.locator('.hd-modal-overlay').count() == 0, 'Reader vừa mở đã có lớp modal phủ')
            expect(select_text_in_reader(pageA, 'Hạ Thần'), 'không bôi đen được "Hạ Thần"')
            pageA.locator('.reader-selection-btn').click(timeout=5000)
            pageA.locator('#ig-from').wait_for(timeout=5000)
            expect(pageA.locator('#ig-from').input_value() == 'Hạ Thần', 'ô cụm gốc sai')
            pageA.get_by_text('Chữ Hán:').wait_for(timeout=8000)
            shot(pageA, '5a_name_modal')
            zh = pageA.locator('p[lang="zh"]').inner_text()
            expect('夏辰' in zh, f'dòng chữ Hán: {zh!r}')
            # Mở rộng cụm sang phải 1 từ rồi trả lại
            pageA.locator('button[aria-label="Mở rộng cụm sang phải 1 từ"]').click()
            expanded = pageA.locator('#ig-from').input_value()
            expect(expanded.startswith('Hạ Thần ') and len(expanded) > len('Hạ Thần '), f'mở rộng phải: {expanded!r}')
            # Bên trái "Hạ Thần" là "Đoạn số 0. " → gặp dấu câu thì không mở rộng (đúng thiết kế).
            expect(pageA.locator('button[aria-label="Mở rộng cụm sang trái 1 từ"]').is_disabled(),
                   'nút mở rộng trái phải bị khoá khi bên trái là dấu câu')
            left = expanded
            pageA.locator('#ig-from').fill('Hạ Thần')
            # Viết hoa
            pageA.locator('#ig-to').fill('hạ thìn')
            pageA.get_by_role('button', name='CHỮ HOA').click()
            v_upper = pageA.locator('#ig-to').input_value()
            pageA.get_by_role('button', name='Viết Hoa Mỗi Chữ').click()
            v_title = pageA.locator('#ig-to').input_value()
            expect(v_upper == 'HẠ THÌN' and v_title == 'Hạ Thìn', f'viết hoa: {v_upper!r}, {v_title!r}')
            pageA.get_by_role('button', name='Áp dụng ngay').click()
            pageA.locator('#ig-from').wait_for(state='detached', timeout=5000)
            txt = reader_text(pageA)
            expect('Hạ Thìn' in txt and 'Hạ Thần' not in txt, 'nội dung chưa đổi Hạ Thần → Hạ Thìn')
            record('5a. Hộp sửa name: chữ Hán + viết hoa + mở rộng + quy tắc cá nhân', True,
                   f'(chữ Hán "{zh.strip()}", mở rộng "{left}")')
        check('5a. Hộp sửa name: chữ Hán + viết hoa + mở rộng + quy tắc cá nhân', t5_personal, pageA)

        def t5_suggest():
            n0 = len(wA.api)
            expect(select_text_in_reader(pageA, 'Lâm Phong'), 'không bôi đen được "Lâm Phong"')
            pageA.locator('.reader-selection-btn').click(timeout=5000)
            pageA.locator('button[aria-label="Mở rộng cụm sang trái 1 từ"]').click()
            left = pageA.locator('#ig-from').input_value()
            expect(left == 'nhìn Lâm Phong', f'mở rộng trái: {left!r}')
            pageA.locator('#ig-from').fill('Lâm Phong')
            pageA.locator('#ig-to').fill('Lam Phong')
            pageA.get_by_text('Gửi góp ý cho mọi người').click()
            orig = pageA.locator('input[placeholder="vd: 洛羽"]')
            wait_for(pageA, lambda: orig.input_value() == '林风', 5)
            expect(orig.input_value() == '林风', f'chữ Hán gốc tự điền: {orig.input_value()!r}')
            pageA.get_by_role('button', name='Áp dụng & gửi góp ý').click()
            post = wait_for(pageA, lambda: wA.find('POST', '/glossary-suggestions', n0), 8)
            expect(post and post[0][2] == 201, f'POST góp ý: {post}')
            record('5b. Gửi góp ý (đăng nhập) → 201', True, f'(mở rộng trái "{left}", body {post[0][3]})')
        check('5b. Gửi góp ý (đăng nhập) → 201', t5_suggest, pageA)

        ctxAd = new_context(browser, base, storage={'authToken': ADMIN_TOKEN, 'userRole': 'admin'})
        pageAd = ctxAd.new_page()
        wAd = PageWatch(pageAd, 'admin')

        def t5_admin():
            pageAd.goto('/admin/glossary-suggestions', wait_until='networkidle')
            pageAd.get_by_text('Lâm Phong', exact=True).first.wait_for(timeout=10000)
            pageAd.get_by_role('button', name=re.compile('Duyệt$')).first.click()
            rv = wait_for(pageAd, lambda: wAd.find('POST', '/review'), 8)
            expect(rv and rv[0][2] == 200, f'POST review: {rv}')
            reps = json.loads(urllib.request.urlopen(f'{base}/api/novels/{SLUG}/replacements', timeout=10).read())
            expect({'from': 'Lâm Phong', 'to': 'Lam Phong', 'whole': True} in reps.get('rules', []), f'replacements: {reps}')
            gl = r2_get_json(persist, f'{SLUG}/glossary.json')
            expect(gl.get('林风') == 'Lam Phong', f'glossary R2: {gl}')
            expect(not wAd.errors, 'lỗi JS admin: ' + ' | '.join(wAd.errors[:3]))
            record('5c. Admin duyệt → /replacements + glossary R2', True, f'(rules {reps["rules"]}, 林风={gl["林风"]})')
        check('5c. Admin duyệt → /replacements + glossary R2', t5_admin, pageAd)
        ctxAd.close()

        def t5_public():
            c = new_context(browser, base)
            p = c.new_page()
            try:
                p.goto(f'/novel/{SLUG}/read/1')
                wait_reader(p)
                ok = wait_for(p, lambda: 'Lam Phong' in reader_text(p), 8)
                txt = reader_text(p)
                expect(ok and 'Lâm Phong' not in txt, 'khách mới chưa thấy quy tắc công khai Lam Phong')
                expect('Hạ Thần' in txt, 'quy tắc CÁ NHÂN bị lộ sang khách khác')
                record('5d. Khách mới thấy quy tắc công khai', True)
            except Exception:
                shot(p, '5d_public')
                raise
            finally:
                c.close()
        check('5d. Khách mới thấy quy tắc công khai', t5_public)

        # 6 ── Đồng bộ prefs A → B
        def t6():
            pageA.goto(f'/novel/{SLUG}/read/1')
            wait_reader(pageA)
            pageA.wait_for_timeout(1000)
            n0 = len(wA.api)
            pageA.locator('button[aria-label="Cài đặt giao diện đọc"]').first.click()
            pageA.locator('.reader-settings-themes button.reader--dark').click()
            set_range(pageA, 'Cỡ chữ', 27)
            put = wait_for(pageA, lambda: [a for a in wA.find('PUT', '/api/user/prefs', n0) if a[2] == 200
                                    and '"theme":"dark"' in (a[3] or '') and '"fontSize":27' in (a[3] or '')], 10, 0.5)
            expect(put, f'không có PUT /api/user/prefs mang theme dark + fontSize 27: {wA.find("PUT", "/api/user/prefs", n0)}')
            pageA.keyboard.press('Escape')
            cB = new_context(browser, base, storage=logged_in)
            pB = cB.new_page()
            wB = PageWatch(pB, 'reader-userB')
            try:
                pB.goto(f'/novel/{SLUG}/read/1')
                wait_reader(pB)
                ok = wait_for(pB, lambda: pB.evaluate(
                    "() => document.querySelector('.reader-root')?.classList.contains('reader--dark') && "
                    "document.querySelector('.reader-content')?.style.fontSize === '27px'"), 8)
                expect(ok, 'context B không nhận theme dark / cỡ chữ 27 từ server')
                got = wB.find('GET', '/api/user/prefs')
                personal = 'Hạ Thìn' in reader_text(pB)
                expect(not wB.errors, 'lỗi JS B: ' + ' | '.join(wB.errors[:3]))
                record('6. Đồng bộ cài đặt đọc A → B', True,
                       f'(PUT sau đổi ~{len(put)} lần, B GET prefs {got[0][2] if got else "?"}, B có quy tắc cá nhân: {personal})')
            except Exception:
                shot(pB, '6_contextB')
                raise
            finally:
                cB.close()
        check('6. Đồng bộ cài đặt đọc A → B', t6, pageA)

        # 7 ── Nền khi mở Reader
        def t7():
            dcl = ("document.addEventListener('DOMContentLoaded', () => { window.__dclBg = "
                   "[getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]; });")
            c = new_context(browser, base, storage={'readerSettings': json.dumps({'theme': 'dark'})}, init_scripts=[dcl])
            p = c.new_page()
            try:
                p.goto(f'/novel/{SLUG}/read/1', wait_until='domcontentloaded')
                bg = p.evaluate('window.__dclBg')
                shot(p, '7_reader_dcl_dark')
                wait_reader(p)
                root_bg = p.evaluate("getComputedStyle(document.querySelector('.reader-root')).backgroundColor")
                expect(bg and bg[1] == 'rgb(26, 26, 26)', f'nền lúc DCL {bg} (mong đợi rgb(26, 26, 26) = dark)')
                expect(root_bg == 'rgb(26, 26, 26)', f'nền .reader-root sau tải: {root_bg}')
                record('7. Nền theo theme lúc DOMContentLoaded', True, f'(html/body lúc DCL {bg}, reader-root {root_bg})')
            except Exception:
                shot(p, '7_bg')
                raise
            finally:
                c.close()
        check('7. Nền theo theme lúc DOMContentLoaded', t7)

        # 8 ── Xuất/nhập gói name
        def t8():
            pageA.goto(f'/novel/{SLUG}/read/1')
            wait_reader(pageA)
            pageA.locator('button[aria-label="Cài đặt giao diện đọc"]').first.click()
            pageA.locator('.reader-settings-replacements-btn').click()
            with pageA.expect_download(timeout=8000) as dl_info:
                pageA.get_by_role('button', name='Xuất', exact=True).click()
            dl = dl_info.value
            path = Path(tempfile.mkdtemp()) / dl.suggested_filename
            dl.save_as(str(path))
            pack = json.loads(path.read_text(encoding='utf-8'))
            froms = {r['from']: r['to'] for r in pack.get('rules', [])}
            expect(pack.get('format') == 'hacdao-names' and froms.get('Hạ Thần') == 'Hạ Thìn', f'gói xuất: {pack}')
            imp = path.parent / 'import.json'
            imp.write_text(json.dumps({'format': 'hacdao-names', 'v': 1, 'slug': SLUG, 'rules': [
                {'from': 'Đoạn số', 'to': 'Phần số', 'whole': True},
                {'from': 'rỗng', 'to': ''},  # hỏng → bị bỏ và đếm
            ]}, ensure_ascii=False), encoding='utf-8')
            file_input = pageA.locator('.replacements-manager input[type=file]')
            notice = pageA.locator('.replacements-manager [role=status]')
            file_input.set_input_files(str(imp))
            notice.wait_for(timeout=5000)
            n_json = notice.inner_text()
            expect('Đã nhập 1 quy tắc' in n_json and 'không hợp lệ' in n_json, f'thông báo nhập JSON: {n_json!r}')
            # Gói văn bản kiểu STV: dòng có chữ Hán ở vế trái bị bỏ
            txt_pack = path.parent / 'names.txt'
            txt_pack.write_text('夏辰=Hạ Thần\ntông môn=môn phái\n', encoding='utf-8')
            file_input.set_input_files(str(txt_pack))
            pageA.locator('.replacements-manager [role=status]', has_text='chữ Hán').wait_for(timeout=5000)
            ntext = notice.inner_text()
            expect('Đã nhập 1 quy tắc' in ntext, f'thông báo nhập TXT: {ntext!r}')
            pageA.locator('.replacements-manager').get_by_role('button', name='Đóng', exact=True).click()
            pageA.keyboard.press('Escape')
            ok = wait_for(pageA, lambda: 'Phần số' in reader_text(pageA) and 'Đoạn số' not in reader_text(pageA)
                          and 'môn phái' in reader_text(pageA), 5)
            expect(ok, 'nhập gói xong nội dung chưa đổi "Đoạn số" → "Phần số"')
            expect(not wA.errors, 'lỗi JS A: ' + ' | '.join(wA.errors[:3]))
            record('8. Xuất/nhập gói name', True, f'(xuất {dl.suggested_filename}: {len(pack["rules"])} quy tắc; nhập JSON "{n_json.strip()}"; nhập TXT "{ntext.strip()}")')
        check('8. Xuất/nhập gói name', t8, pageA)
        ctxA.close()

        # 9 ── Nhiều bản dịch
        def t9_reader():
            # Tiến độ server đang ở đoạn 20 của chương 1 (bản mặc định).
            d1_query(persist, "UPDATE reading_progress SET chapter = 1, position = '1#p20', client_updated_at = NULL "
                              f"WHERE user_id = 1 AND slug = '{SLUG}'")
            d1_query(persist, "INSERT OR IGNORE INTO reading_progress (user_id, slug, chapter, position, type) "
                              f"VALUES (1, '{SLUG}', 1, '1#p20', 'chapter')")
            c = new_context(browser, base, storage=logged_in)
            p = c.new_page()
            wp = PageWatch(p, 'edition')
            try:
                p.goto(f'/novel/{SLUG}/read/1?ban={EDITION}')
                wait_reader(p)
                ok = wait_for(p, lambda: 'Bản nhóm E2E đoạn 0' in reader_text(p), 8)
                expect(ok, 'Reader ?ban không hiện nội dung bản phụ')
                put = wait_for(p, lambda: wp.find('PUT', f'/api/user/progress/{SLUG}'), 8)
                expect(put and put[0][2] == 200, f'PUT progress: {put}')
                body = json.loads(put[0][3] or '{}')
                expect(body.get('keep_paragraph') is True and 'paragraph' not in body, f'body PUT: {body}')
                row = d1_query(persist, f"SELECT chapter, position FROM reading_progress WHERE user_id = 1 AND slug = '{SLUG}'")
                expect(row and row[0]['position'] == '1#p20', f'D1 position sau khi đọc bản phụ: {row}')
                stored = p.evaluate(f"localStorage.getItem('hd:ban:{SLUG}')")
                expect(stored == EDITION, f'hd:ban = {stored!r}')
                hist = json.loads(p.evaluate("localStorage.getItem('reading_history_v2')") or '[]')
                entry = next((h for h in hist if h.get('slug') == SLUG), {})
                expect(entry.get('ban') == EDITION, f'lịch sử: {entry}')
                # Trang chủ + Tủ truyện: "Đọc tiếp" mang ?ban=
                p.goto('/', wait_until='networkidle')
                # Mục "Vừa đọc gần đây" nằm trong LazyMount → cuộn dần tới khi được gắn vào DOM.
                link = p.locator(f'a[href="/novel/{SLUG}/read/1?ban={EDITION}"]')
                ok = wait_for(p, lambda: p.mouse.wheel(0, 500) or link.count() > 0, 10)
                expect(ok, 'trang chủ: không thấy link "Đọc tiếp" có ?ban=')
                p.goto('/library', wait_until='networkidle')
                p.locator(f'a[href="/novel/{SLUG}/read/1?ban={EDITION}"]').first.wait_for(timeout=10000)
                # NovelPage hiện đúng bản đang đọc (nút Đọc tiếp cũng mang ?ban).
                p.goto(f'/novel/{SLUG}', wait_until='networkidle')
                p.locator(f'a[href="/novel/{SLUG}/read/1?ban={EDITION}"]').first.wait_for(timeout=10000)
                expect(not wp.errors, 'lỗi JS: ' + ' | '.join(wp.errors[:3]))
                record('9a. Đọc ?ban giữ N#pM + Đọc tiếp nhớ bản dịch', True, f'(PUT {body}, D1 {row[0]["position"]})')
            except Exception:
                shot(p, '9a_edition')
                raise
            finally:
                c.close()
        check('9a. Đọc ?ban giữ N#pM + Đọc tiếp nhớ bản dịch', t9_reader)

        def t9_admin():
            c = new_context(browser, base, storage={'authToken': ADMIN_TOKEN, 'userRole': 'admin'})
            p = c.new_page()
            wp = PageWatch(p, 'admin-editions')
            try:
                p.goto('/admin', wait_until='networkidle')
                p.get_by_role('link', name='Bản dịch').first.click()
                p.wait_for_url('**/admin/editions', timeout=8000)
                p.get_by_text('Nhóm E2E đồng ý cho đăng (thư 2026-11-26)').first.wait_for(timeout=10000)
                p.locator('input[aria-label="Lọc theo slug truyện"]').fill(SLUG)
                p.get_by_role('button', name='Lọc', exact=True).click()
                p.get_by_text('Đang hiện', exact=True).first.wait_for(timeout=8000)
                p.once('dialog', lambda d: d.accept())
                p.get_by_role('button', name=re.compile('^Ẩn bản dịch')).first.click()
                post = wait_for(p, lambda: wp.find('POST', f'/api/admin/novels/{SLUG}/editions/{EDITION}'), 8)
                expect(post and post[0][2] == 200, f'POST ẩn: {post}')
                p.get_by_text('Đang ẩn', exact=True).first.wait_for(timeout=8000)
                row = d1_query(persist, f"SELECT e.published, n.edition_count FROM editions e JOIN novels n ON n.slug = e.novel_slug WHERE e.code = '{EDITION}'")
                expect(row and row[0]['published'] == 0 and row[0]['edition_count'] == 0, f'D1: {row}')
                pub = json.loads(urllib.request.urlopen(f'{base}/api/novels/{SLUG}/editions', timeout=10).read())
                expect([e['code'] for e in pub['editions']] == ['he-thong'], f'/editions công khai: {pub}')
                acts = d1_query(persist, "SELECT action, note FROM admin_actions WHERE action LIKE 'edition_%'")
                expect(acts == [{'action': 'edition_hide', 'note': EDITION}], f'admin_actions: {acts}')
                expect(not wp.errors, 'lỗi JS admin: ' + ' | '.join(wp.errors[:3]))
                record('9b. Admin ẩn bản dịch', True, f'(D1 {row[0]}, /editions {[e["code"] for e in pub["editions"]]})')
            except Exception:
                shot(p, '9b_admin_editions')
                raise
            finally:
                c.close()
        check('9b. Admin ẩn bản dịch', t9_admin)
        browser.close()


def main():
    if not (HD_DIR / 'node_modules/.bin/wrangler').exists():
        sys.exit(f'Thiếu {HD_DIR}/node_modules (đặt HD_DIR tới bản sao đã npm ci)')
    if not (HD_DIR / 'frontend/dist/index.html').exists():
        sys.exit(f'Thiếu {HD_DIR}/frontend/dist (build frontend trước)')
    persist = Path(tempfile.mkdtemp(prefix='e2e-persist-'))
    port, bport = free_port(), free_port()
    base = f'http://127.0.0.1:{port}'
    backend = ThreadingHTTPServer(('127.0.0.1', bport), FakeBackend)
    threading.Thread(target=backend.serve_forever, daemon=True).start()
    log_path = persist.parent / f'{persist.name}-wrangler.log'
    log = open(log_path, 'w')
    proc = None
    try:
        print('Seed D1/R2 local...', flush=True)
        seed(persist)
        proc = subprocess.Popen(
            ['npx', 'wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', str(port), '--persist-to', str(persist),
             '--var', 'VIEW_TOKEN_SECRET:e2e-view-token-secret-0123456789',
             '--var', f'BACKEND_URL:http://127.0.0.1:{bport}',
             '--show-interactive-dev-session=false'],
            cwd=HD_DIR, env=ENV, stdout=log, stderr=subprocess.STDOUT)
        for _ in range(240):
            try:
                urllib.request.urlopen(base + '/api/server-info', timeout=1).close()
                break
            except OSError:
                if proc.poll() is not None:
                    raise RuntimeError('wrangler dev thoát sớm — xem ' + str(log_path))
                time.sleep(0.5)
        else:
            raise RuntimeError('wrangler dev không lên')
        print(f'wrangler dev: {base}  backend giả: {bport}', flush=True)
        scenario(base, persist)
    finally:
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()
        backend.shutdown()
        log.close()
        if not os.environ.get('E2E_KEEP'):
            shutil.rmtree(persist, ignore_errors=True)
        else:
            print('Giữ persist:', persist, 'log:', log_path)
    print('\n==== KẾT QUẢ ====')
    for item, status, detail in RESULTS:
        print(f'{status:4}  {item}  {detail}')
    fails = sum(1 for r in RESULTS if r[1] == 'FAIL')
    print(f'{len(RESULTS) - fails}/{len(RESULTS)} PASS')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
