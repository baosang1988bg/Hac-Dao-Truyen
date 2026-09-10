"""Xác minh bằng Chrome thật cho 3 việc chưa kiểm chứng ở
plans/KE_HOACH_NANG_CAP_DOC_2026-09-09.md (mục 3.1, 4.1, 5.1):
  1. Đồng bộ tiến độ đọc EPUB đa thiết bị (Đợt 2)
  2. Đọc EPUB offline sau khi tải (Đợt 3) — cần service worker thật (bản build)
  3. Text-to-Speech (Đợt 4)

API/EPUB được giả lập (không cần backend thật), theo đúng mẫu tests/browser/reader_settings.py.
"""
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from ebooklib import epub
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]


def make_test_epub(path):
    book = epub.EpubBook()
    book.set_identifier('verify-test')
    book.set_title('Kiểm thử nâng cấp đọc')
    book.set_language('vi')
    chapters = []
    for i in (1, 2):
        c = epub.EpubHtml(title=f'Chương {i}', file_name=f'chap{i}.xhtml', lang='vi')
        c.content = f'<h1>Chương {i}</h1>' + '<p>Nội dung kiểm thử. </p>' * 40
        book.add_item(c)
        chapters.append(c)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = chapters
    book.toc = tuple(chapters)
    epub.write_epub(str(path), book)


def wait_for_server(origin, proc):
    for _ in range(120):
        try:
            urllib.request.urlopen(origin, timeout=1).close()
            return
        except OSError:
            if proc.poll() is not None:
                raise RuntimeError('Server không khởi động')
            time.sleep(.25)
    raise RuntimeError('Hết thời gian chờ server')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def start_vite(mode, cwd, port):
    args = ['node', str(ROOT / 'frontend/node_modules/vite/bin/vite.js')]
    args += ['preview'] if mode == 'preview' else []
    args += ['--host', '127.0.0.1', '--port', str(port), '--strictPort']
    log = open(Path(tempfile.gettempdir()) / f'hacdao-vite-{mode}-{port}.log', 'w')
    return subprocess.Popen(args, cwd=cwd, stdout=log, stderr=log)


def api_router(origin, epub_bytes, epub_requests, progress_store):
    """Route handler dùng chung: giả lập /api/novels/*, /api/user/progress."""
    def handle(route):
        req = route.request
        endpoint = urlparse(req.url).path
        if not req.url.startswith(origin + '/'):
            return route.fulfill(status=200, body='')
        if not endpoint.startswith('/api/'):
            return route.continue_()

        if endpoint.endswith('/epub'):
            epub_requests.append(req.url)
            return route.fulfill(status=200, content_type='application/epub+zip', body=epub_bytes)

        if endpoint == '/api/user/progress' and req.method == 'GET':
            rows = [{'slug': slug, **data} for slug, data in progress_store.items()]
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(rows))

        if endpoint.startswith('/api/user/progress/') and req.method == 'PUT':
            slug = endpoint.rsplit('/', 1)[-1]
            body = json.loads(req.post_data or '{}')
            progress_store[slug] = {
                'chapter': body.get('chapter'),
                'position': body.get('position'),
                'type': body.get('type', 'chapter'),
                'updated_at': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
            }
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True}))

        data = []
        if endpoint == '/api/novels/demo':
            data = {'slug': 'demo', 'title': 'Kiểm thử nâng cấp đọc', 'has_epub': True}
        elif endpoint.endswith('/chapters'):
            data = [{'filename': '1.md', 'chapter_number': 1, 'title': 'Chương 1'}]
        elif '/chapters/' in endpoint:
            data = {'content': '# Chương 1\n\nNội dung kiểm thử.'}
        elif endpoint.endswith('/view'):
            data = {'ok': True}
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
    return handle


def verify_multi_device_sync(p, origin, epub_bytes):
    """Đợt 2: máy A đổi vị trí CFI, máy B (context riêng, cùng token) phải khôi phục đúng."""
    progress_store = {}
    epub_requests = []
    browser = p.chromium.launch(headless=True)

    def make_context():
        ctx = browser.new_context(service_workers='block')
        ctx.add_init_script("localStorage.setItem('userToken', 'u_fake-token-for-test')")
        ctx.route('**/*', api_router(origin, epub_bytes, epub_requests, progress_store))
        return ctx

    ctx_a = make_context()
    page_a = ctx_a.new_page()
    errors_a = []
    page_a.on('pageerror', lambda e: errors_a.append(str(e)))
    page_a.goto(origin + '/novel/demo/epub-reader')
    expect(page_a.locator('.epub-container, [style*="reader-root"]').first).to_be_visible(timeout=15000)
    time.sleep(1.5)  # dành thời gian cho 'relocated' đầu tiên fire + PUT progress
    page_a.get_by_title('Trang sau', exact=False).first.click() if page_a.get_by_title('Trang sau').count() else None
    # Điều hướng sang chương/trang kế để CFI thực sự đổi khỏi vị trí ban đầu.
    page_a.keyboard.press('ArrowRight')
    time.sleep(1)
    assert 'mot-truyen-epub' not in progress_store  # sanity: đúng slug 'demo'
    assert 'demo' in progress_store, f'Máy A chưa PUT progress lên server: {progress_store}'
    assert progress_store['demo']['type'] == 'epub'
    remote_cfi = progress_store['demo']['position']
    assert remote_cfi, 'Server chưa có CFI'
    ctx_a.close()

    # Máy B: KHÔNG có localStorage CFI cục bộ, chỉ có server progress → phải nạp đúng vị trí server.
    ctx_b = make_context()
    page_b = ctx_b.new_page()
    errors_b = []
    page_b.on('pageerror', lambda e: errors_b.append(str(e)))
    page_b.goto(origin + '/novel/demo/epub-reader')
    expect(page_b.locator('.epub-container, [style*="reader-root"]').first).to_be_visible(timeout=15000)
    time.sleep(1.5)
    local_cfi = page_b.evaluate("localStorage.getItem('epub_cfi_demo')")
    ctx_b.close()
    browser.close()

    assert not errors_a and not errors_b, f'Lỗi JS: A={errors_a} B={errors_b}'
    assert local_cfi == remote_cfi, f'Máy B không khôi phục đúng CFI server: local={local_cfi!r} remote={remote_cfi!r}'
    print(f'PASS Đợt 2: máy B khôi phục đúng CFI server ({remote_cfi[:40]}...)', flush=True)


def verify_offline_epub(p, origin, epub_bytes):
    """Đợt 3: tải EPUB offline (?offline=1 qua sw.js) rồi đọc lại khi ngắt mạng hoàn toàn."""
    epub_requests = []
    progress_store = {}
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(service_workers='allow')
    context.add_init_script("localStorage.removeItem('userToken')")
    context.route('**/*', api_router(origin, epub_bytes, epub_requests, progress_store))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(origin + '/novel/demo/epub-reader')
    page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)

    # Tải offline trực tiếp qua fetch (tương đương bấm nút Download ở EpubCard).
    status = page.evaluate("""async () => {
        const res = await fetch('/api/novels/demo/epub?offline=1');
        return res.status;
    }""")
    assert status == 200, f'Tải offline thất bại: HTTP {status}'
    has_cache = page.evaluate("""async () => {
        const cache = await caches.open('hacdao-epub-v1');
        return Boolean(await cache.match('/api/novels/demo/epub'));
    }""")
    assert has_cache, 'sw.js không lưu EPUB vào cache hacdao-epub-v1 khi có ?offline=1'

    # SW chỉ bắt đầu kiểm soát TỪ lần điều hướng kế tiếp trở đi (giới hạn của mọi
    # service worker, không riêng gì Đợt 3) — app shell/bundle JS của lần load đầu
    # tiên chưa chắc đã được cache-first bắt kịp. Reload 1 lần khi còn mạng để mô
    # phỏng đúng luồng thật: người dùng đã mở app trước đó rồi mới bấm tải offline.
    page.reload()
    expect(page.locator('.epub-container, [style*="reader-root"]').first).to_be_visible(timeout=15000)

    context.set_offline(True)
    page.reload()
    expect(page.locator('.epub-container, [style*="reader-root"]').first).to_be_visible(timeout=15000)
    assert 'Không tải được EPUB' not in page.content(), 'Trang báo lỗi dù EPUB đã tải offline'
    context.set_offline(False)
    context.close()
    browser.close()
    assert not errors, f'Lỗi JS khi đọc offline: {errors}'
    print('PASS Đợt 3: EPUB đã tải offline đọc được sau khi ngắt mạng hoàn toàn (DevTools Offline)', flush=True)


def verify_tts(p, origin, epub_bytes):
    """Đợt 4: nút play/pause/stop gọi đúng window.speechSynthesis, dừng khi đổi chương."""
    epub_requests = []
    progress_store = {}
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(service_workers='block')
    context.add_init_script("localStorage.removeItem('userToken')")
    context.route('**/*', api_router(origin, epub_bytes, epub_requests, progress_store))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    supported = page.evaluate("'speechSynthesis' in window")
    if not supported:
        print('SKIP Đợt 4: Chromium headless không có speechSynthesis trong môi trường này', flush=True)
        context.close()
        browser.close()
        return

    page.goto(origin + '/novel/demo/read/1')
    expect(page.get_by_text('Nội dung kiểm thử.', exact=True)).to_be_visible()

    page.get_by_title('Nghe chương này').click()
    speaking_after_play = page.evaluate("window.speechSynthesis.speaking || window.speechSynthesis.pending")
    page.get_by_title('Tạm dừng đọc').click()
    time.sleep(.2)
    paused = page.evaluate("window.speechSynthesis.paused")
    page.get_by_title('Dừng đọc').click()
    time.sleep(.2)
    stopped = not page.evaluate("window.speechSynthesis.speaking")

    context.close()
    browser.close()
    assert not errors, f'Lỗi JS khi dùng TTS: {errors}'
    result = f'play_triggered={speaking_after_play} paused={paused} stopped={stopped}'
    if speaking_after_play and paused and stopped:
        print(f'PASS Đợt 4: play/pause/stop hoạt động đúng trạng thái ({result})', flush=True)
    else:
        print(f'FAIL Đợt 4: trạng thái không như kỳ vọng ({result}) — '
              f'lưu ý Chromium headless có thể thiếu engine giọng đọc thật, cần thử lại trên Chrome desktop thật', flush=True)


def main():
    with tempfile.TemporaryDirectory(prefix='hacdao-verify-') as temp:
        path = Path(temp)
        epub_path = path / 'test.epub'
        make_test_epub(epub_path)
        epub_bytes = epub_path.read_bytes()

        # Đợt 2 & 4: dev server đủ dùng (không cần service worker thật).
        dev_port = free_port()
        dev_proc = start_vite('dev', ROOT / 'frontend', dev_port)
        try:
            dev_origin = f'http://127.0.0.1:{dev_port}'
            wait_for_server(dev_origin, dev_proc)
            with sync_playwright() as p:
                verify_multi_device_sync(p, dev_origin, epub_bytes)
                verify_tts(p, dev_origin, epub_bytes)
        finally:
            dev_proc.terminate()
            try:
                dev_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                dev_proc.kill()

        # Đợt 3: cần service worker thật → phải chạy trên bản build (preview), không phải dev mode.
        subprocess.run(['node', str(ROOT / 'frontend/node_modules/vite/bin/vite.js'), 'build'],
                        cwd=ROOT / 'frontend', check=True, capture_output=True)
        preview_port = free_port()
        preview_proc = start_vite('preview', ROOT / 'frontend', preview_port)
        try:
            preview_origin = f'http://127.0.0.1:{preview_port}'
            wait_for_server(preview_origin, preview_proc)
            with sync_playwright() as p:
                verify_offline_epub(p, preview_origin, epub_bytes)
        finally:
            preview_proc.terminate()
            try:
                preview_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                preview_proc.kill()


if __name__ == '__main__':
    main()
