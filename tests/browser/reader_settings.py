"""Unit hook React và kịch bản UI đợt 1 bằng Chrome local, API/EPUB giả lập."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlparse
from ebooklib import epub
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]


def main():
    with tempfile.TemporaryDirectory(prefix='hacdao-settings-') as temp:
        path = Path(temp)
        book = epub.EpubBook()
        book.set_identifier('settings-test')
        book.set_title('Kiểm thử settings')
        book.set_language('vi')
        chapter = epub.EpubHtml(title='Chương 1', file_name='chapter.xhtml', lang='vi')
        chapter.content = '<h1>Chương 1</h1><p>Nội dung kiểm thử settings.</p>'
        book.add_item(chapter)
        book.add_item(epub.EpubNcx())
        book.add_item(epub.EpubNav())
        book.spine = [chapter]
        book.toc = (chapter,)
        epub.write_epub(str(path / 'test.epub'), book)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        with (path / 'vite.log').open('w+') as log:
            server = subprocess.Popen(['node', str(ROOT / 'frontend/node_modules/vite/bin/vite.js'),
                '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=ROOT / 'frontend', stdout=log, stderr=log)
            try:
                origin = f'http://127.0.0.1:{port}'
                for _ in range(120):
                    try:
                        urllib.request.urlopen(origin, timeout=1).close()
                        break
                    except OSError:
                        if server.poll() is not None:
                            raise RuntimeError('Vite không khởi động')
                        time.sleep(.25)
                else:
                    raise RuntimeError('Hết thời gian chờ Vite')
                with sync_playwright() as p:
                    options = {'headless': True}
                    if os.getenv('HACDAO_BROWSER_PATH'):
                        options['executable_path'] = os.environ['HACDAO_BROWSER_PATH']
                    browser = p.chromium.launch(**options)
                    context = browser.new_context(service_workers='block')
                    errors = []
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
                    epub_requests = []

                    def handle(route):
                        endpoint = urlparse(route.request.url).path
                        if not route.request.url.startswith(origin + '/'):
                            route.fulfill(status=200, body='')
                        elif not endpoint.startswith('/api/'):
                            route.continue_()
                        elif endpoint.endswith('/epub'):
                            epub_requests.append(endpoint)
                            route.fulfill(status=200, content_type='application/epub+zip', body=(path / 'test.epub').read_bytes())
                        else:
                            data = []
                            if endpoint == '/api/novels/demo':
                                data = {'slug': 'demo', 'title': 'Kiểm thử settings'}
                            elif endpoint.endswith('/chapters'):
                                data = [{'filename': '1.md', 'chapter_number': 1, 'title': 'Chương 1'}]
                            elif '/chapters/' in endpoint:
                                data = {'content': '# Chương 1\n\nNội dung kiểm thử settings.'}
                            route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

                    context.route('**/*', handle)
                    page.goto(origin + '/tests/reader-settings.html')
                    results = page.evaluate("async () => (await import('/tests/useReaderSettings.browser.js')).runHookTests()")
                    for result in results:
                        print('PASS hook:', result, flush=True)

                    def open_reader():
                        page.goto(origin + '/novel/demo/read/1')
                        expect(page.get_by_text('Nội dung kiểm thử settings.', exact=True)).to_be_visible()
                        page.get_by_title('Cài đặt giao diện').first.click()

                    def set_range(label, value):
                        control = page.get_by_role('slider', name=label, exact=True)
                        control.fill(str(value))
                        control.dispatch_event('input')
                        control.dispatch_event('change')

                    open_reader()
                    page.get_by_role('button', name='Chủ đề Xanh lá', exact=True).click()
                    set_range('Cỡ chữ', 26)
                    set_range('Độ rộng', 950)
                    set_range('Giãn dòng', 2)
                    page.get_by_label('Font chữ', exact=True).select_option('Georgia, serif')
                    expected = {'fontSize': 26, 'fontFamily': 'Georgia, serif', 'theme': 'green', 'contentWidth': 950, 'lineHeight': 2}
                    assert page.evaluate("JSON.parse(localStorage.getItem('readerSettings'))") == expected
                    page.goto(origin + '/novel/demo/epub-reader')
                    content = page.frame_locator('iframe').first.locator('p')
                    expect(content).to_have_text('Nội dung kiểm thử settings.')
                    expect(content).to_have_css('font-size', '26px')
                    expect(content).to_have_css('line-height', '52px')
                    expect(content).to_have_css('font-family', 'Georgia, serif')
                    expect(page.frame_locator('iframe').first.locator('body')).to_have_css('background-color', 'rgb(232, 245, 233)')
                    page.get_by_role('button', name='Cài đặt giao diện').click()
                    expect(page.get_by_role('slider', name='Độ rộng', exact=True)).to_have_value('950')
                    for label, color in [('Trắng', 'rgb(255, 255, 255)'), ('Giấy', 'rgb(244, 236, 216)'), ('Tối', 'rgb(26, 26, 26)'), ('Xanh lam', 'rgb(240, 244, 248)')]:
                        page.get_by_role('button', name=f'Chủ đề {label}', exact=True).click()
                        expect(page.frame_locator('iframe').first.locator('body')).to_have_css('background-color', color)
                    set_range('Độ rộng', 500)
                    expect(page.locator('.epub-container')).to_have_css('width', '500px')
                    set_range('Giãn dòng', 2.2)
                    set_range('Cỡ chữ', 28)
                    expect(content).to_have_css('font-size', '28px')
                    expect(content).to_have_css('line-height', '61.6px')
                    assert len(epub_requests) == 1, 'Đổi settings không được tải lại EPUB'
                    open_reader()
                    expect(page.get_by_role('slider', name='Cỡ chữ', exact=True)).to_have_value('28')
                    expect(page.get_by_role('button', name='Chủ đề Xanh lam', exact=True)).to_have_attribute('aria-pressed', 'true')
                    print('PASS UI: Reader → EPUB → Reader; 5 theme CSS, font/size/lineHeight/width; không tải lại EPUB', flush=True)

                    page.evaluate("""() => {
                        localStorage.removeItem('readerSettings');
                        localStorage.setItem('epub_theme', 'dark');
                        localStorage.setItem('epub_fontSize', '12');
                        localStorage.setItem('epub_font', 'serif');
                    }""")
                    page.reload()
                    expect(page.get_by_text('Nội dung kiểm thử settings.', exact=True)).to_be_visible()
                    page.get_by_title('Cài đặt giao diện').first.click()
                    expect(page.get_by_role('slider', name='Cỡ chữ', exact=True)).to_have_value('12')
                    expect(page.get_by_role('button', name='Chủ đề Tối', exact=True)).to_have_attribute('aria-pressed', 'true')
                    assert page.evaluate("['epub_theme','epub_fontSize','epub_font'].map(k => localStorage.getItem(k))") == [None, None, None]
                    page.goto(origin + '/novel/demo/epub-reader')
                    content = page.frame_locator('iframe').first.locator('p')
                    expect(content).to_have_css('font-size', '12px')
                    expect(content).to_have_css('font-family', 'serif')
                    print('PASS UI: xóa readerSettings, giữ epub_* rồi reload; migrate và mở EPUB đúng', flush=True)
                    assert not errors, errors
                    browser.close()
                    print(f'RESULT: {len(results)} hook tests + 2 UI scenarios passed; 0 browser errors', flush=True)
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == '__main__':
    main()
