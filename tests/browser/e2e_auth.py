"""E2E THẬT cho đăng nhập / quản lý tài khoản (nhánh feature/auth-google).

Dựng `wrangler dev --local` (D1/R2 giả lập trong thư mục persist tạm, có
GOOGLE_CLIENT_ID + AUTH_SECRET) + Chromium headless (Playwright). Frontend PHẢI
build CÓ VITE_GOOGLE_CLIENT_ID=e2e-client.apps.googleusercontent.com.
Không gọi Google thật: `page.route` chặn https://accounts.google.com/gsi/client
và trả script giả định nghĩa window.google.accounts.id (initialize lưu callback +
nonce, renderButton vẽ nút giả, prompt đếm số lần gọi).

Kịch bản:
  g. One Tap: khách đã đọc ≥ 2 chương → trang chủ gọi prompt(); tắt → reload không gọi lại
  a. Khách gõ bình luận → LoginDialog → đăng ký trong hộp → bình luận tự gửi (D1), header avatar chữ cái
  d. Gộp lịch sử đọc local lên D1 reading_progress; đăng nhập lại không đẩy lại (cờ authMerged:<id>)
  c. Trang Tài khoản: thẻ thông tin + mục "Liên kết Google" (credential giả bị Worker từ chối mà KHÔNG mất
     phiên), đổi mật khẩu sai/đúng, 2 thiết bị, thu hồi máy kia, đăng xuất tất cả
  i. Tài khoản chỉ Google (API /api/user/* GIẢ LẬP bằng page.route): đặt mật khẩu lần đầu → 403
     reauth_required → nút "Xác nhận lại bằng Google" → gửi lại kèm credential; xoá tài khoản tương tự
  b. Nút Google: nonce từ /api/user/google-nonce vào initialize; credential giả → 401/503 → báo lỗi dễ hiểu
  j. Google-login 409 link_required (response GIẢ LẬP) → hiện đúng thông báo "đăng nhập mật khẩu rồi liên kết"
  e. Xoá tài khoản (U1 đăng ký bằng email → bắt buộc mật khẩu hiện tại): sai email/thiếu mật khẩu → nút khoá;
     sai mật khẩu → 403, vẫn đăng nhập; đúng → về trang chủ, D1 ẩn danh, bình luận "Người dùng đã xoá"
  f. /chinh-sach-bao-mat + sitemap + link footer + link trong LoginDialog
  h. Mobile 390×844: LoginDialog dạng sheet, nút ≥ 44px, không tràn ngang

Chạy (sandbox Linux):
  export LD_LIBRARY_PATH=$HOME/stublib
  HD_DIR=/tmp/hd E2E_OUT=/path/out python3 tests/browser/e2e_auth.py
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

import e2e_engagement as eng
from e2e_engagement import (ENV, HD_DIR, API_TIMES, FakeBackend, PageWatch, d1_query, expect, free_port,
                            new_context, pace, wait_for, wrangler)

OUT_DIR = Path(os.environ.get('E2E_OUT', str(Path(tempfile.gettempdir()) / 'hacdao-e2e-auth')))
eng.OUT_DIR = OUT_DIR
CLIENT_ID = 'e2e-client.apps.googleusercontent.com'
AUTH_SECRET = 'e2e-auth-secret-0123456789abcdef-XYZ'
NOVELS = [('e2e-auth-a', 'Truyện Đăng Nhập A', 2), ('e2e-auth-b', 'Truyện Đăng Nhập B', 1)]
SLUG_A, SLUG_B = NOVELS[0][0], NOVELS[1][0]
U1 = {'email': 'tran.e2e@example.com', 'name': 'Trần E2E', 'pw': 'matkhau-cu-123', 'pw2': 'matkhau-moi-456'}
U2 = {'email': 'google.fallback@example.com', 'name': 'Khách Google', 'pw': 'matkhau-khac-789'}
COMMENT = 'Chương này hay quá — bình luận E2E giữ nguyên nội dung! ✓'
AUTH_PATHS = ('/api/user/login', '/api/user/register', '/api/user/google-login', '/api/user/password',
              '/api/user/account', '/api/user/link-google', '/api/auth/login')
# Phải khớp LINK_REQUIRED_MESSAGE trong frontend/src/utils/authHelpers.js.
LINK_REQUIRED_MSG = ('Email này đã có tài khoản Hắc Đạo Truyện. Hãy đăng nhập bằng mật khẩu, '
                     'sau đó vào Tài khoản → Liên kết Google.')
AUTH_TIMES = []  # hạn mức 'auth' 10 request/phút/IP
RESULTS = []

FAKE_GIS = r"""
(function () {
  var st = window.__gis = { inits: [], prompts: 0, cancels: 0, buttons: 0, promptCb: null, cfg: null };
  window.google = window.google || {};
  window.google.accounts = { id: {
    initialize: function (cfg) { st.cfg = cfg; st.inits.push({ client_id: cfg.client_id, nonce: cfg.nonce || null,
                                                              fedcm: !!cfg.use_fedcm_for_prompt }); },
    renderButton: function (el, opts) {
      st.buttons++;
      el.innerHTML = '';
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'e2e-gis-btn'; b.textContent = 'Tiếp tục với Google (giả)';
      b.style.cssText = 'min-height:44px;width:100%;border-radius:999px';
      b.onclick = function () {
        try { opts && opts.click_listener && opts.click_listener(); } catch (e) {}
        st.cfg.callback({ credential: window.__e2eCredential || 'a.b.c', select_by: 'btn' });
      };
      el.appendChild(b);
    },
    prompt: function (cb) { st.prompts++; st.promptCb = cb || null; },
    cancel: function () { st.cancels++; },
    disableAutoSelect: function () {}
  } };
  window.__e2eDismissOneTap = function () {
    if (st.promptCb) st.promptCb({ isDismissedMoment: function () { return true; },
      getDismissedReason: function () { return 'cancel_called'; },
      isSkippedMoment: function () { return false; }, isNotDisplayed: function () { return false; } });
  };
})();
"""


def record(item, ok, detail=''):
    RESULTS.append((item, 'PASS' if ok else 'FAIL', detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {item} {detail}", flush=True)


def shot(page, name):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / f'{name}.png'
    try:
        page.screenshot(path=str(p), full_page=False)
    except Exception:
        pass
    return p


def pace_auth(budget=7):
    waited = 0
    while sum(1 for t in AUTH_TIMES if time.time() - t < 60) >= budget and waited < 65:
        time.sleep(1)
        waited += 1
    if waited:
        print(f'  (pace auth: chờ {waited}s cho hạn mức 10 req/phút/IP)', flush=True)


def check(item, fn, page=None):
    pace(budget=60, label=item[:20])
    try:
        fn()
    except Exception as e:
        record(item, False, f'{type(e).__name__}: {str(e)[:600]}')
        traceback.print_exc()
        if page is not None:
            shot(page, 'FAIL_' + re.sub(r'\W+', '_', item)[:50])


def b64url(obj):
    raw = obj if isinstance(obj, bytes) else json.dumps(obj, separators=(',', ':')).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def fake_jwt(nonce):
    now = int(time.time())
    header = {'alg': 'RS256', 'kid': 'e2e-fake-kid-khong-ton-tai', 'typ': 'JWT'}
    payload = {'iss': 'https://accounts.google.com', 'aud': CLIENT_ID, 'sub': '1234567890', 'email': 'gia@example.com',
               'email_verified': True, 'name': 'Giả Mạo', 'iat': now, 'exp': now + 3600, 'nonce': nonce}
    return f'{b64url(header)}.{b64url(payload)}.{b64url(os.urandom(256))}'


# ── Seed ────────────────────────────────────────────────────────────────────
def seed(persist):
    tmp = Path(tempfile.mkdtemp(prefix='e2e-auth-seed-'))
    sql = []
    for slug, title, n_ch in NOVELS:
        sql.append(
            f"INSERT INTO novels (slug, title, original_title, author, genre, status, synopsis, published, total_chapters, "
            f"chapter_count, updated_at) VALUES ('{slug}', '{title}', '测试', 'Tác Giả E2E', 'Tiên hiệp', 'ongoing', "
            f"'Truyện thử nghiệm đăng nhập.', 1, {n_ch}, {n_ch}, datetime('now'));")
        for n in range(1, n_ch + 1):
            fn = f'{n:04d}_VI.md'
            sql.append(f"INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key) "
                       f"VALUES ('{slug}', '{fn}', 'Chương {n}', {n}, '{slug}/{fn}');")
            p = tmp / f'{slug}-{fn}'
            p.write_text(f'# Chương {n}\n\n' + '\n\n'.join(
                f'Đoạn {i} của {title} chương {n}. Gió thổi qua sơn cốc, trăng sáng soi đường.' for i in range(12)),
                encoding='utf-8')
            wrangler('r2', 'object', 'put', f'hacdao-chapters/{slug}/{fn}', '--local', '--persist-to', str(persist),
                     '--file', str(p), '--content-type', 'text/markdown; charset=utf-8')
    wrangler('d1', 'execute', 'hacdao-db', '--local', '--persist-to', str(persist), f'--file={HD_DIR / "schema.sql"}')
    s = tmp / 'seed.sql'
    s.write_text('\n'.join(sql), encoding='utf-8')
    wrangler('d1', 'execute', 'hacdao-db', '--local', '--persist-to', str(persist), f'--file={s}')
    shutil.rmtree(tmp, ignore_errors=True)


# ── Tiện ích UI ─────────────────────────────────────────────────────────────
def auth_context(browser, base, **kw):
    ctx = new_context(browser, base, **kw)

    def gis(route):
        route.fulfill(status=200, body=FAKE_GIS, content_type='text/javascript')
    ctx.route('https://accounts.google.com/gsi/client**', gis)
    ctx.on('request', lambda r: AUTH_TIMES.append(time.time())
           if any(r.url.split('?')[0].endswith(p) for p in AUTH_PATHS) else None)
    return ctx


def gis_state(page):
    return page.evaluate("() => window.__gis ? { inits: window.__gis.inits, prompts: window.__gis.prompts, "
                         "buttons: window.__gis.buttons } : null")


def logged_in(page):
    return bool(page.evaluate("localStorage.getItem('userToken')"))


def dialog(page):
    return page.locator('.login-dialog')


def fill_auth_panel(scope, mode, email, pw, name=None):
    """Điền AuthPanel (trong LoginDialog hoặc trang Tài khoản) rồi bấm nút gửi."""
    pace_auth()
    if mode == 'register':
        scope.get_by_role('tab', name='Đăng ký').click()
        if name:
            scope.locator('input[aria-label="Tên hiển thị (không bắt buộc)"]').fill(name)
    else:
        scope.get_by_role('tab', name='Đăng nhập').click()
    scope.locator('input[aria-label="Email"]').fill(email)
    scope.locator('input[aria-label="Mật khẩu"]').fill(pw)
    scope.locator('button.auth-submit').click()


def open_reader_bottom(page, slug, ch):
    page.goto(f'/novel/{slug}/read/{ch}')
    page.wait_for_selector('.reader-p', timeout=20000)
    box = page.locator('textarea[aria-label="Nội dung bình luận"]')
    for _ in range(20):
        if box.count():
            break
        page.mouse.wheel(0, 3000)
        page.wait_for_timeout(300)
    box.scroll_into_view_if_needed(timeout=10000)
    return box


def header_login(page):
    page.locator('button.user-menu__login').click()
    dialog(page).wait_for(timeout=10000)


def user_id_of(persist, email):
    rows = d1_query(persist, f"SELECT id FROM users WHERE email = '{email}'")
    return rows[0]['id'] if rows else None


# ── Kịch bản ────────────────────────────────────────────────────────────────
def scenario(base, persist):
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--no-proxy-server'])
        state = {}

        # ── Context chính: khách → U1 ──
        ctx = auth_context(browser, base)
        page = ctx.new_page()
        w = PageWatch(page, 'main')

        def tg():
            for slug, _, _ in NOVELS:
                page.goto(f'/novel/{slug}/read/1')
                page.wait_for_selector('.reader-p', timeout=20000)
                page.wait_for_timeout(800)
            hist = json.loads(page.evaluate("localStorage.getItem('reading_history_v2')") or '[]')
            expect(len({h.get('slug') for h in hist}) >= 2, f'lịch sử local chưa đủ 2 truyện: {hist}')
            n0 = len(w.api)
            page.goto('/', wait_until='networkidle')
            st = wait_for(page, lambda: (gis_state(page) or {}).get('prompts', 0) >= 1 and gis_state(page), 15)
            expect(st, f'trang chủ không gọi prompt() (gis={gis_state(page)})')
            nonce_resp = [a for a in w.find('GET', '/api/user/google-nonce', n0) if a[2] == 200]
            expect(nonce_resp and nonce_resp[-1][4].get('nonce'), f'GET google-nonce: {nonce_resp}')
            server_nonce = nonce_resp[-1][4]['nonce']
            init = st['inits'][-1]
            expect(init['client_id'] == CLIENT_ID and init['nonce'] == server_nonce,
                   f'initialize nhận {init}, nonce server {server_nonce}')
            page.evaluate('window.__e2eDismissOneTap()')
            flag = page.evaluate("localStorage.getItem('oneTapDismissed')")
            expect(flag == '1', f'tắt One Tap không ghi cờ: {flag!r}')
            page.reload(wait_until='networkidle')
            page.wait_for_timeout(7000)  # runWhenIdle timeout 5s + tải script
            st2 = gis_state(page)
            expect(not st2 or st2['prompts'] == 0, f'reload vẫn gọi prompt(): {st2}')
            expect(not w.errors, 'lỗi JS: ' + ' | '.join(w.errors[:3]))
            record('g. One Tap (≥2 chương → prompt; tắt → không gọi lại)', True,
                   f'(prompt {st["prompts"]} lần, nonce khớp {server_nonce[:14]}…, sau reload: {st2})')
        check('g. One Tap (≥2 chương → prompt; tắt → không gọi lại)', tg, page)

        def ta():
            box = open_reader_bottom(page, SLUG_A, 2)
            box.fill(COMMENT)
            n0 = len(w.api)
            page.get_by_role('button', name='Đăng nhập & gửi').click()
            dlg = dialog(page)
            dlg.wait_for(timeout=10000)
            title = dlg.locator('h2').inner_text()
            expect('bình luận' in title, f'tiêu đề hộp: {title!r}')
            fill_auth_panel(dlg, 'register', U1['email'], U1['pw'], U1['name'])
            post = wait_for(page, lambda: [a for a in w.find('POST', f'/api/novels/{SLUG_A}/comments', n0)], 12)
            expect(post and post[0][2] in (200, 201), f'POST comment: {post}')
            body = json.loads(post[0][3])
            expect(body.get('content') == COMMENT, f'nội dung gửi bị đổi: {body}')
            dlg.wait_for(state='detached', timeout=8000)
            rows = d1_query(persist, f"SELECT c.content, c.chapter, u.email FROM comments c JOIN users u ON u.id = c.user_id "
                                     f"WHERE c.slug = '{SLUG_A}'")
            expect(rows and rows[0]['content'] == COMMENT and rows[0]['email'] == U1['email'], f'D1 comments: {rows}')
            page.locator('.comment-item__content', has_text=COMMENT).first.wait_for(timeout=8000)
            expect(box.input_value() == '', 'ô bình luận chưa xoá sau khi gửi')
            state['u1'] = user_id_of(persist, U1['email'])
            # Reader không có header site → kiểm avatar ở trang chủ (merge chạy nền, PageWatch vẫn ghi).
            page.goto('/', wait_until='networkidle')
            av = page.locator('.user-menu__trigger .user-avatar')
            av.wait_for(timeout=8000)
            expect(av.inner_text().strip() == 'T', f'avatar chữ cái: {av.inner_text()!r}')
            expect(not w.errors, 'lỗi JS: ' + ' | '.join(w.errors[:3]))
            record('a. Bình luận khách → đăng ký trong hộp → tự gửi', True,
                   f'(D1 comments {rows[0]}, avatar "{av.inner_text().strip()}")')
        check('a. Bình luận khách → đăng ký trong hộp → tự gửi', ta, page)

        def td():
            uid = state.get('u1')
            expect(uid, 'chưa có user U1')
            put_b = wait_for(page, lambda: w.find('PUT', f'/api/user/progress/{SLUG_B}'), 12)
            expect(put_b and put_b[0][2] == 200, f'gộp: không thấy PUT progress truyện B: {put_b}')
            rows = d1_query(persist, f"SELECT slug, chapter, position FROM reading_progress WHERE user_id = {uid} ORDER BY slug")
            slugs = {r['slug'] for r in rows}
            expect({SLUG_A, SLUG_B} <= slugs, f'D1 reading_progress: {rows}')
            flag = page.evaluate(f"localStorage.getItem('authMerged:{uid}')")
            expect(flag, 'không có cờ authMerged')
            # Đăng xuất qua menu → đăng nhập lại ở trang chủ → không đẩy lại
            page.goto('/', wait_until='networkidle')
            page.locator('.user-menu__trigger').click()
            page.locator('.user-menu__panel').get_by_role('button', name='Đăng xuất').click()
            page.locator('button.user-menu__login').wait_for(timeout=8000)
            expect(not logged_in(page), 'đăng xuất xong vẫn còn userToken')
            n0 = len(w.api)
            header_login(page)
            fill_auth_panel(dialog(page), 'login', U1['email'], U1['pw'])
            page.locator('.user-menu__trigger').wait_for(timeout=10000)
            page.wait_for_timeout(7000)
            again = w.find('PUT', '/api/user/progress/', n0) + w.find('GET', '/api/user/progress', n0)
            expect(not again, f'đăng nhập lại vẫn gộp lại: {again}')
            record('d. Gộp lịch sử local → D1; đăng nhập lại không đẩy lại', True,
                   f'(D1 {[(r["slug"], r["position"]) for r in rows]}, cờ authMerged:{uid}={flag})')
        check('d. Gộp lịch sử local → D1; đăng nhập lại không đẩy lại', td, page)

        def tc():
            page.goto('/account', wait_until='networkidle')
            card = page.locator('.account-profile')
            card.wait_for(timeout=10000)
            expect(U1['email'] in card.inner_text(), f'thẻ thiếu email: {card.inner_text()!r}')
            wait_for(page, lambda: card.locator('.account-badge', has_text='Mật khẩu').count() > 0, 8)
            badges = card.locator('.account-badges').inner_text() if card.locator('.account-badges').count() else ''
            expect('Mật khẩu' in badges and 'Chưa đặt' not in badges, f'nhãn has_password: {badges!r}')
            # Liên kết Google: U1 chưa có Google (has_google=false) + build có CLIENT_ID → hiện mục.
            # Credential giả 'a.b.c' → Worker từ chối (401 kèm reason / 503 JWKS) → báo lỗi, KHÔNG mất phiên
            # (userApi chỉ xoá phiên khi 401 của link-google KHÔNG có reason).
            lg = card.locator('.account-link-google')
            lg.wait_for(timeout=8000)
            expect('Liên kết Google' in lg.inner_text(), f'mục liên kết: {lg.inner_text()!r}')
            lg.locator('.e2e-gis-btn').wait_for(timeout=10000)
            n_lg = len(w.api)
            pace_auth()
            lg.locator('.e2e-gis-btn').click()
            r_lg = wait_for(page, lambda: w.find('POST', '/api/user/link-google', n_lg), 10)
            expect(r_lg, 'không có POST /api/user/link-google')
            lg.locator('[role=alert]').wait_for(timeout=8000)
            msg_lg = lg.locator('[role=alert]').inner_text()
            expect(r_lg[0][2] in (400, 401, 503) and len(msg_lg) > 15, f'link-google HTTP {r_lg[0][2]}, UI {msg_lg!r}')
            page.wait_for_timeout(600)
            expect(logged_in(page) and page.locator('.account-profile').count() == 1,
                   f'link-google lỗi (HTTP {r_lg[0][2]}) mà bị đá khỏi phiên')
            # Đổi mật khẩu sai
            pwsec = page.locator('details', has=page.locator('summary', has_text='Đổi mật khẩu'))
            pwsec.locator('summary').click()
            pwsec.get_by_label('Mật khẩu hiện tại').fill('sai-mat-khau-000')
            pwsec.get_by_label('Mật khẩu mới (tối thiểu 8 ký tự)').fill(U1['pw2'])
            pwsec.get_by_label('Nhập lại mật khẩu mới').fill(U1['pw2'])
            n0 = len(w.api)
            pace_auth()
            pwsec.locator('button[type=submit]').click()
            pwsec.locator('[role=alert]', has_text='Mật khẩu hiện tại không đúng').wait_for(timeout=8000)
            r_bad = w.find('POST', '/api/user/password', n0)
            page.wait_for_timeout(800)
            expect(logged_in(page) and page.locator('.account-profile').count() == 1,
                   'sai mật khẩu hiện tại mà bị đá ra khỏi phiên')
            # Đổi đúng
            pwsec.get_by_label('Mật khẩu hiện tại').fill(U1['pw'])
            pwsec.get_by_label('Mật khẩu mới (tối thiểu 8 ký tự)').fill(U1['pw2'])
            pwsec.get_by_label('Nhập lại mật khẩu mới').fill(U1['pw2'])
            pace_auth()
            pwsec.locator('button[type=submit]').click()
            pwsec.locator('[role=status]', has_text='Đã đổi mật khẩu').wait_for(timeout=8000)
            expect(logged_in(page), 'đổi mật khẩu đúng xong mất phiên')
            # Context 2 đăng nhập cùng tài khoản
            ctx2 = auth_context(browser, base)
            p2 = ctx2.new_page()
            w2 = PageWatch(p2, 'second')
            try:
                p2.goto('/account', wait_until='networkidle')
                fill_auth_panel(p2.locator('.auth-box').first, 'login', U1['email'], U1['pw2'])
                p2.locator('.account-profile').wait_for(timeout=10000)
                # Context 1 xem thiết bị
                devs = page.locator('details', has=page.locator('summary', has_text='Thiết bị đang đăng nhập'))
                devs.locator('summary').click()
                ok = wait_for(page, lambda: devs.locator('.session-row').count() == 2, 8)
                expect(ok, f'danh sách thiết bị: {devs.locator(".session-row").count()} dòng (mong 2)')
                other = devs.locator('.session-row').filter(has_not=page.locator('.account-badge', has_text='Máy này'))
                expect(other.count() == 1, f'máy khác: {other.count()}')
                other.locator('button').click()
                wait_for(page, lambda: devs.locator('.session-row').count() == 1, 8)
                st = p2.evaluate("""async () => (await fetch('/api/user/me', { headers: { Authorization:
                    'Bearer ' + localStorage.getItem('userToken') } })).status""")
                expect(st == 401, f'context 2 /user/me sau khi bị thu hồi: {st}')
                p2.goto('/account', wait_until='networkidle')
                ok2 = wait_for(p2, lambda: not logged_in(p2) and p2.locator('.auth-box').count() > 0, 10)
                expect(ok2, f'context 2 vẫn hiện đăng nhập (token={logged_in(p2)}, auth-box={p2.locator(".auth-box").count()})')
                expect(not w2.errors, 'lỗi JS ctx2: ' + ' | '.join(w2.errors[:3]))
            except Exception:
                shot(p2, 'FAIL_c_context2')
                raise
            finally:
                ctx2.close()
            # Đăng xuất tất cả
            page.once('dialog', lambda d: d.accept())
            devs.get_by_role('button', name='Đăng xuất tất cả thiết bị').click()
            ok3 = wait_for(page, lambda: not logged_in(page) and page.locator('.auth-box').count() > 0, 8)
            expect(ok3, 'đăng xuất tất cả xong vẫn ở trạng thái đăng nhập')
            n_sess = d1_query(persist, f"SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = {state['u1']}")[0]['n']
            expect(n_sess == 0, f'D1 còn {n_sess} phiên')
            expect(not w.errors, 'lỗi JS: ' + ' | '.join(w.errors[:3]))
            record('c. Tài khoản: thẻ, liên kết Google, đổi mật khẩu sai/đúng, thiết bị, thu hồi, đăng xuất tất cả', True,
                   f'(link-google giả → HTTP {r_lg[0][2]} "{msg_lg}", vẫn đăng nhập; '
                   f'sai mật khẩu → HTTP {r_bad[0][2] if r_bad else "?"} vẫn đăng nhập; ctx2 /user/me → {st}; D1 phiên còn {n_sess})')
        check('c. Tài khoản: thẻ, liên kết Google, đổi mật khẩu sai/đúng, thiết bị, thu hồi, đăng xuất tất cả', tc, page)

        def te():
            uid = state.get('u1')
            page.goto('/account', wait_until='networkidle')
            fill_auth_panel(page.locator('.auth-box').first, 'login', U1['email'], U1['pw2'])
            page.locator('.account-profile').wait_for(timeout=10000)
            sec = page.locator('details', has=page.locator('summary', has_text='Xoá tài khoản'))
            sec.locator('summary').click()
            inp = sec.locator('input[type=email]:not([hidden])')
            btn = sec.locator('button[type=submit]')
            inp.fill('nham@example.com')
            expect(btn.is_disabled(), 'gõ sai email mà nút xoá không bị khoá')
            inp.fill('  ' + U1['email'].upper() + ' ')
            # U1 đăng ký bằng email → có mật khẩu → ô "Mật khẩu hiện tại" bắt buộc.
            pw_inp = sec.get_by_label('Mật khẩu hiện tại')
            pw_inp.wait_for(timeout=8000)
            expect(btn.is_disabled(), 'đúng email nhưng chưa nhập mật khẩu mà nút xoá không khoá')
            pw_inp.fill('sai-mat-khau-000')
            expect(btn.is_enabled(), 'đúng email + có mật khẩu mà nút vẫn khoá')
            n_del = len(w.api)
            pace_auth()
            btn.click()
            sec.locator('[role=alert]', has_text='Mật khẩu hiện tại không đúng').wait_for(timeout=8000)
            r_del = w.find('DELETE', '/api/user/account', n_del)
            expect(r_del and r_del[0][2] == 403 and (r_del[0][4] or {}).get('reason') == 'reauth_required',
                   f'xoá với mật khẩu sai: {r_del}')
            expect(logged_in(page), 'sai mật khẩu khi xoá mà mất phiên')
            pw_inp.fill(U1['pw2'])
            pace_auth()
            btn.click()
            page.wait_for_url(re.compile(r'^' + re.escape(base) + r'/?$'), timeout=10000)
            expect(not logged_in(page), 'xoá xong vẫn còn userToken')
            page.locator('button.user-menu__login').wait_for(timeout=8000)
            row = d1_query(persist, f"SELECT email, name, password_hash, google_id, deleted_at FROM users WHERE id = {uid}")
            expect(row and row[0]['email'] == f'deleted-{uid}@invalid' and row[0]['name'] == 'Người dùng đã xoá'
                   and row[0]['password_hash'] == '' and row[0]['deleted_at'], f'D1 users: {row}')
            left = d1_query(persist, f"SELECT (SELECT COUNT(*) FROM user_sessions WHERE user_id={uid}) AS s, "
                                     f"(SELECT COUNT(*) FROM reading_progress WHERE user_id={uid}) AS p")
            expect(left[0]['s'] == 0 and left[0]['p'] == 0, f'D1 còn dữ liệu: {left}')
            open_reader_bottom(page, SLUG_A, 2)
            item = page.locator('.comment-item', has_text=COMMENT).first
            item.wait_for(timeout=10000)
            who = item.locator('.comment-item__name').inner_text()
            expect(who == 'Người dùng đã xoá', f'tên trên bình luận cũ: {who!r}')
            expect(not w.errors, 'lỗi JS: ' + ' | '.join(w.errors[:3]))
            record('e. Xoá tài khoản (bắt buộc mật khẩu hiện tại)', True,
                   f'(mật khẩu sai → HTTP 403 reauth_required; D1 {row[0]["email"]}, bình luận cũ hiện "{who}")')
        check('e. Xoá tài khoản (bắt buộc mật khẩu hiện tại)', te, page)
        ctx.close()

        # ── b. Nút Google với credential giả ──
        ctxb = auth_context(browser, base)
        pb = ctxb.new_page()
        wb = PageWatch(pb, 'google')

        def tb():
            pb.goto('/', wait_until='networkidle')
            n0 = len(wb.api)
            header_login(pb)
            dlg = dialog(pb)
            dlg.locator('.e2e-gis-btn').wait_for(timeout=10000)
            nonce_resp = [a for a in wb.find('GET', '/api/user/google-nonce', n0) if a[2] == 200]
            expect(nonce_resp and nonce_resp[-1][4].get('nonce'), f'GET google-nonce: {nonce_resp}')
            server_nonce = nonce_resp[-1][4]['nonce']
            st = gis_state(pb)
            expect(st['inits'][-1]['nonce'] == server_nonce and st['inits'][-1]['client_id'] == CLIENT_ID,
                   f'initialize: {st["inits"][-1]} ≠ nonce server {server_nonce}')
            # 1) credential 'a.b.c'
            pace_auth()
            dlg.locator('.e2e-gis-btn').click()
            r1 = wait_for(pb, lambda: wb.find('POST', '/api/user/google-login', n0), 10)
            expect(r1, 'không có POST /user/google-login')
            err = dlg.locator('.google-login__error')
            err.wait_for(timeout=8000)
            msg1 = err.inner_text()
            expect(r1[0][2] in (401, 503) and len(msg1) > 20, f'HTTP {r1[0][2]}, thông báo {msg1!r}')
            # 2) JWT tự ký với nonce MỚI (sau lỗi, nút khởi tạo lại với nonce mới)
            ok = wait_for(pb, lambda: len(gis_state(pb)['inits']) > len(st['inits']), 8)
            expect(ok, 'sau lỗi không khởi tạo lại GIS (nonce mới)')
            new_nonce = gis_state(pb)['inits'][-1]['nonce']
            expect(new_nonce and new_nonce != server_nonce, f'nonce mới: {new_nonce}')
            pb.evaluate(f'window.__e2eCredential = {json.dumps(fake_jwt(new_nonce))}')
            n1 = len(wb.api)
            pace_auth()
            dlg.locator('.e2e-gis-btn').click()
            r2 = wait_for(pb, lambda: wb.find('POST', '/api/user/google-login', n1), 15)
            expect(r2 and r2[0][2] in (401, 503), f'JWT giả: {r2}')
            pb.wait_for_timeout(500)
            msg2 = dlg.locator('.google-login__error').inner_text() if dlg.locator('.google-login__error').count() else ''
            expect(msg2, 'JWT giả: không hiện thông báo lỗi')
            if r2[0][2] == 503 and (r2[0][4] or {}).get('reason') == 'jwks_unavailable':
                expect('chưa bật' not in msg2, f'503 jwks_unavailable mà UI báo "chưa bật đăng nhập Google": {msg2!r}')
            expect(not logged_in(pb), 'credential giả mà lại đăng nhập được!')
            # 3) form email vẫn dùng được (đăng ký tài khoản khác)
            fill_auth_panel(dlg, 'register', U2['email'], U2['pw'], U2['name'])
            dlg.wait_for(state='detached', timeout=10000)
            expect(logged_in(pb), 'đăng ký email sau lỗi Google thất bại')
            expect(not wb.errors, 'lỗi JS: ' + ' | '.join(wb.errors[:3]))
            record('b. Google: nonce + credential giả bị từ chối, form email vẫn dùng được', True,
                   f'(a.b.c → HTTP {r1[0][2]} reason={r1[0][4].get("reason") if r1[0][4] else "?"}; '
                   f'JWT tự ký → HTTP {r2[0][2]} reason={r2[0][4].get("reason") if r2[0][4] else "?"}; '
                   f'UI: "{msg1}" / "{msg2}")')
        check('b. Google: nonce + credential giả bị từ chối, form email vẫn dùng được', tb, pb)
        ctxb.close()

        # ── i. Tài khoản CHỈ Google: xác nhận lại bằng Google (API giả lập) ──
        # Sandbox không tạo được id_token Google hợp lệ (JWKS bị chặn → Worker 503)
        # nên KHÔNG có tài khoản chỉ-Google thật trong D1. Kiểm riêng phần UI: mọi
        # /api/user/* (trừ google-nonce — vẫn lấy nonce thật) do page.route trả lời
        # đúng hợp đồng Worker (403 reason 'reauth_required' khi chưa kèm credential).
        fake_user = {'id': 990001, 'email': 'chi.google@gmail.com', 'name': 'Chỉ Google', 'has_password': False,
                     'has_google': True, 'email_verified': True, 'created_at': '2026-11-27 08:00:00'}
        ctxi = auth_context(browser, base, storage={
            'userToken': 'e2e-token-gia-lap', 'userInfo': json.dumps(fake_user),
            f'authMerged:{fake_user["id"]}': '1'})
        pi = ctxi.new_page()
        wi = PageWatch(pi, 'reauth')
        mocked = []

        def user_api(route):
            req = route.request
            path = req.url.split('?')[0].split('://', 1)[1].split('/', 1)[1]
            path = '/' + path
            if path.endswith('/user/google-nonce'):
                return route.continue_()
            body = {}
            try:
                body = json.loads(req.post_data or '{}') if req.method in ('POST', 'PUT', 'DELETE') else {}
            except ValueError:
                pass
            mocked.append((req.method, path, body))

            def reply(status, data):
                route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
            if path == '/api/user/me':
                return reply(200, fake_user)
            if path == '/api/user/password' and req.method == 'POST':
                if body.get('credential'):
                    return reply(200, {'ok': True, 'has_password': True})
                return reply(403, {'error': 'Vui lòng xác nhận lại bằng Google trước khi đặt mật khẩu',
                                   'reason': 'reauth_required'})
            if path == '/api/user/account' and req.method == 'DELETE':
                if body.get('confirm', '').lower() != fake_user['email']:
                    return reply(400, {'error': 'Email xác nhận không khớp'})
                if body.get('credential'):
                    return reply(200, {'ok': True})
                return reply(403, {'error': 'Vui lòng xác nhận lại bằng Google trước khi xoá tài khoản',
                                   'reason': 'reauth_required'})
            if req.method == 'GET' and (path.endswith('/bookmarks') or path.endswith('/progress')):
                return reply(200, [])
            return reply(200, {} if req.method == 'GET' else {'ok': True})

        def ti():
            pi.route('**/api/user/**', user_api)
            pi.goto('/account', wait_until='networkidle')
            card = pi.locator('.account-profile')
            card.wait_for(timeout=10000)
            expect(card.locator('.account-link-google').count() == 0, 'has_google=true mà vẫn hiện mục Liên kết Google')
            # Đặt mật khẩu lần đầu
            pwsec = pi.locator('details', has=pi.locator('summary', has_text='Đặt mật khẩu'))
            pwsec.locator('summary').click()
            expect(pwsec.get_by_label('Mật khẩu hiện tại').count() == 0, 'đặt lần đầu mà vẫn hỏi mật khẩu hiện tại')
            pwsec.get_by_label('Mật khẩu mới (tối thiểu 8 ký tự)').fill('matkhau-dau-tien-1')
            pwsec.get_by_label('Nhập lại mật khẩu mới').fill('matkhau-dau-tien-1')
            pwsec.locator('button[type=submit]').click()
            pwsec.locator('[role=alert]', has_text='xác nhận lại bằng Google').wait_for(timeout=8000)
            reauth = pwsec.locator('.account-reauth')
            reauth.locator('.e2e-gis-btn').wait_for(timeout=10000)
            expect('Xác nhận lại bằng Google' in reauth.inner_text(), f'khối xác nhận: {reauth.inner_text()!r}')
            reauth.locator('.e2e-gis-btn').click()
            pwsec.locator('[role=status]', has_text='Đã đặt mật khẩu').wait_for(timeout=8000)
            posts = [m for m in mocked if m[0] == 'POST' and m[1] == '/api/user/password']
            expect(len(posts) == 2 and 'credential' not in posts[0][2]
                   and posts[1][2].get('credential') == 'a.b.c'
                   and posts[1][2].get('new_password') == 'matkhau-dau-tien-1',
                   f'POST /user/password: {posts}')
            expect(pwsec.locator('.account-reauth').count() == 0, 'đặt xong vẫn hiện khối xác nhận Google')
            # Xoá tài khoản chỉ Google: không có ô mật khẩu; thử gửi → 403 → xác nhận Google → gửi lại
            sec = pi.locator('details', has=pi.locator('summary', has_text='Xoá tài khoản'))
            sec.locator('summary').click()
            expect(sec.get_by_label('Mật khẩu hiện tại').count() == 0, 'tài khoản chỉ Google mà đòi mật khẩu khi xoá')
            btn = sec.locator('button[type=submit]')
            sec.locator('input[type=email]:not([hidden])').fill(fake_user['email'])
            expect(btn.is_enabled(), 'gõ đúng email mà nút xoá vẫn khoá')
            btn.click()
            sec.locator('[role=alert]', has_text='xác nhận lại bằng Google').wait_for(timeout=8000)
            expect(logged_in(pi), '403 reauth_required mà mất phiên')
            sreauth = sec.locator('.account-reauth')
            sreauth.locator('.e2e-gis-btn').wait_for(timeout=10000)
            sreauth.locator('.e2e-gis-btn').click()
            pi.wait_for_url(re.compile(r'^' + re.escape(base) + r'/?$'), timeout=10000)
            expect(not logged_in(pi), 'xoá xong vẫn còn userToken')
            dels = [m for m in mocked if m[0] == 'DELETE' and m[1] == '/api/user/account']
            expect(len(dels) == 2 and 'credential' not in dels[0][2] and dels[1][2].get('credential') == 'a.b.c'
                   and 'current_password' not in dels[1][2], f'DELETE /user/account: {dels}')
            expect(not wi.errors, 'lỗi JS: ' + ' | '.join(wi.errors[:3]))
            record('i. Chỉ Google: reauth_required → xác nhận Google → gửi lại (API giả lập)', True,
                   f'(password: {[sorted(p[2]) for p in posts]}; account: {[sorted(d[2]) for d in dels]})')
        check('i. Chỉ Google: reauth_required → xác nhận Google → gửi lại (API giả lập)', ti, pi)
        ctxi.close()

        # ── j. Google-login 409 link_required ──
        # Không dựng được id_token Google hợp lệ trong sandbox (JWKS của Google bị
        # chặn → Worker trả 503 TRƯỚC khi tới bước so email), nên giả response 409
        # cho /api/user/google-login bằng page.route để kiểm riêng phần UI. Phần
        # Worker (googleOwnsEmail → 409 link_required) đã có test ở tests/worker.
        ctxj = auth_context(browser, base)
        pj = ctxj.new_page()
        wj = PageWatch(pj, 'link_required')

        def tj():
            hits = []

            def google_login(route):
                hits.append(route.request.post_data)
                route.fulfill(status=409, content_type='application/json', body=json.dumps({
                    'error': 'Email này đã có tài khoản. Hãy đăng nhập bằng mật khẩu rồi liên kết Google trong trang Tài khoản.',
                    'reason': 'link_required'}))
            pj.route('**/api/user/google-login', google_login)
            pj.goto('/', wait_until='networkidle')
            header_login(pj)
            dlg = dialog(pj)
            dlg.locator('.e2e-gis-btn').wait_for(timeout=10000)
            dlg.locator('.e2e-gis-btn').click()
            err = dlg.locator('.google-login__error')
            err.wait_for(timeout=8000)
            msg = err.inner_text().strip()
            expect(hits, 'không có POST /api/user/google-login')
            expect(msg == LINK_REQUIRED_MSG, f'thông báo 409 link_required: {msg!r}')
            expect(not logged_in(pj), '409 mà lại đăng nhập')
            expect(not wj.errors, 'lỗi JS: ' + ' | '.join(wj.errors[:3]))
            record('j. Google-login 409 link_required → thông báo đúng (response giả lập)', True, f'("{msg}")')
        check('j. Google-login 409 link_required → thông báo đúng (response giả lập)', tj, pj)
        ctxj.close()

        # ── f. Chính sách bảo mật ──
        ctxf = auth_context(browser, base)
        pf = ctxf.new_page()
        wf = PageWatch(pf, 'privacy')

        def tf():
            raw = urllib.request.urlopen(f'{base}/chinh-sach-bao-mat', timeout=15)
            expect(raw.status == 200, f'HTTP /chinh-sach-bao-mat {raw.status}')
            sm = urllib.request.urlopen(f'{base}/sitemap.xml', timeout=15).read().decode('utf-8')
            expect('/chinh-sach-bao-mat</loc>' in sm, 'sitemap.xml thiếu /chinh-sach-bao-mat')
            pf.goto('/chinh-sach-bao-mat', wait_until='networkidle')
            pf.get_by_role('heading', name='Chính sách bảo mật', level=1).wait_for(timeout=10000)
            pf.goto('/', wait_until='networkidle')
            foot = pf.locator('footer a[href="/chinh-sach-bao-mat"]')
            expect(foot.count() >= 1, 'footer không có link chính sách')
            header_login(pf)
            link = dialog(pf).locator('a[href="/chinh-sach-bao-mat"]')
            expect(link.count() == 1, 'LoginDialog không có link chính sách')
            link.click()
            pf.wait_for_url('**/chinh-sach-bao-mat', timeout=8000)
            dialog(pf).wait_for(state='detached', timeout=5000)
            expect(not wf.errors, 'lỗi JS: ' + ' | '.join(wf.errors[:3]))
            record('f. Trang chính sách bảo mật + sitemap + link footer/LoginDialog', True)
        check('f. Trang chính sách bảo mật + sitemap + link footer/LoginDialog', tf, pf)
        ctxf.close()

        # ── h. Mobile 390×844 ──
        ctxh = auth_context(browser, base, viewport={'width': 390, 'height': 844})
        ph = ctxh.new_page()
        wh = PageWatch(ph, 'mobile')

        def th():
            box = open_reader_bottom(ph, SLUG_A, 1)
            box.fill('Bình luận trên điện thoại')
            ph.get_by_role('button', name='Đăng nhập & gửi').click()
            dlg = dialog(ph)
            dlg.wait_for(timeout=10000)
            dlg.locator('.e2e-gis-btn').wait_for(timeout=10000)
            ph.wait_for_timeout(600)  # animation trượt lên
            shot(ph, 'h_mobile_login_sheet')
            m = ph.evaluate("""() => {
              const d = document.querySelector('.login-dialog');
              const r = d.getBoundingClientRect();
              const sel = ['.request-novel-modal__close', '.auth-tab', '.auth-submit', '.input-field', '.e2e-gis-btn'];
              const small = [];
              for (const s of sel) for (const el of d.querySelectorAll(s)) {
                const b = el.getBoundingClientRect();
                if (b.width && b.height < 44) small.push(`${s} ${Math.round(b.width)}x${Math.round(b.height)}`);
              }
              const wide = [...d.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
                .map(el => el.className || el.tagName).slice(0, 5);
              return { cls: d.className, left: r.left, right: r.right, bottom: r.bottom, top: r.top,
                       vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth,
                       dlgOverflow: d.scrollWidth - d.clientWidth, small, wide };
            }""")
            expect('hd-modal-panel--sheet' in m['cls'], f'không phải sheet: {m["cls"]}')
            expect(abs(m['bottom'] - m['vh']) <= 2 and m['left'] <= 1 and m['right'] >= m['vw'] - 1,
                   f'sheet không dính đáy/full ngang: {m}')
            expect(not m['small'], f'nút/ô < 44px: {m["small"]}')
            expect(m['docW'] <= m['vw'] and m['dlgOverflow'] <= 0 and not m['wide'], f'tràn ngang: {m}')
            expect(not wh.errors, 'lỗi JS: ' + ' | '.join(wh.errors[:3]))
            record('h. Mobile 390×844: LoginDialog dạng sheet', True,
                   f'(top {m["top"]:.0f}→bottom {m["bottom"]:.0f}, docW {m["docW"]}, ảnh h_mobile_login_sheet.png)')
        check('h. Mobile 390×844: LoginDialog dạng sheet', th, ph)
        ctxh.close()
        browser.close()


def main():
    if not (HD_DIR / 'node_modules/.bin/wrangler').exists():
        sys.exit(f'Thiếu {HD_DIR}/node_modules')
    dist = HD_DIR / 'frontend/dist'
    if not (dist / 'index.html').exists():
        sys.exit(f'Thiếu {dist} (build frontend trước)')
    if not any(CLIENT_ID in p.read_text(errors='ignore') for p in (dist / 'assets').glob('*.js')):
        sys.exit(f'frontend/dist build KHÔNG có VITE_GOOGLE_CLIENT_ID={CLIENT_ID} — build lại')
    persist = Path(tempfile.mkdtemp(prefix='e2e-auth-persist-'))
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
             '--var', f'GOOGLE_CLIENT_ID:{CLIENT_ID}',
             '--var', f'AUTH_SECRET:{AUTH_SECRET}',
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
        print(f'wrangler dev: {base}', flush=True)
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
