"""Kiểm tra trình duyệt với API giả lập, không gọi Cloudflare/provider thật."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlparse, parse_qs
from ebooklib import epub
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
novel = {'slug':'demo','title':'Truyện kiểm thử','author':'Tác giả','genre':'Tiên hiệp',
         'chapter_count':2,'total_chapters':2,'glossary_count':1,'glossary':{'甲':'Giáp'},
         'status':'ongoing','has_epub':1,'views':1,'rating':4,'rating_count':1,'synopsis':'Giới thiệu',
         'last_translated_at':1700000000}
chapters = [{'filename':f'Chương {i}.md','chapter_number':i,'title':f'Chương {i}'} for i in (1,2)]


def main():
    with tempfile.TemporaryDirectory(prefix='hacdao-browser-') as temp:
        path = Path(temp)
        book=epub.EpubBook();book.set_identifier('test');book.set_title('Truyện kiểm thử');book.set_language('vi')
        ch=epub.EpubHtml(title='Mở đầu',file_name='ch1.xhtml',lang='vi');ch.content='<h1>Mở đầu EPUB</h1><p>Nội dung kiểm thử EPUB.</p>'
        book.add_item(ch);book.add_item(epub.EpubNcx());book.add_item(epub.EpubNav());book.spine=['nav',ch];book.toc=(ch,)
        epub.write_epub(str(path/'test.epub'),book)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        log=(path/'vite.log').open('w+')
        server=subprocess.Popen(['node',str(ROOT/'frontend/node_modules/vite/bin/vite.js'),
            '--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=ROOT/'frontend',stdout=log,stderr=log)
        try:
            origin=f'http://127.0.0.1:{port}'
            for _ in range(120):
                try:
                    urllib.request.urlopen(origin,timeout=1).close();break
                except OSError:
                    if server.poll() is not None: raise RuntimeError('Vite không khởi động được')
                    time.sleep(.25)
            else: raise RuntimeError('Hết thời gian chờ Vite')
            with sync_playwright() as p:
                options={'headless':True}
                if os.getenv('HACDAO_BROWSER_PATH'):options['executable_path']=os.environ['HACDAO_BROWSER_PATH']
                browser=p.chromium.launch(**options)
                try:
                    for shape in ('local','cloud'):
                        context=browser.new_context()
                        errors=[];console_errors=[]
                        page=context.new_page()
                        page.on('pageerror',lambda error:errors.append(str(error)))
                        page.on('console',lambda message:console_errors.append(message.text) if message.type=='error' else None)
                        def handle(route):
                            url=urlparse(route.request.url); endpoint=url.path
                            if not route.request.url.startswith(origin):
                                route.fulfill(status=200,content_type='image/svg+xml' if route.request.resource_type=='image' else 'text/plain',body='<svg xmlns="http://www.w3.org/2000/svg"/>' if route.request.resource_type=='image' else '');return
                            if not endpoint.startswith('/api/'):
                                route.continue_();return
                            if endpoint.endswith('/epub'):
                                route.fulfill(status=200,content_type='application/epub+zip',body=(path/'test.epub').read_bytes());return
                            data={}
                            if endpoint=='/api/novels':
                                query=parse_qs(url.query)
                                admin=query.get('limit')==['200']
                                pg=int(query.get('page',['1'])[0])
                                item=novel if pg==1 else {**novel,'slug':'demo2','title':'Truyện trang hai'}
                                data=[novel] if shape=='local' else {'novels':[item],'total':2 if admin else 1,'page':pg,'pages':2 if admin else 1,'limit':200 if admin else 48}
                            elif endpoint=='/api/novels/demo':data=novel
                            elif endpoint.endswith('/chapters'):data=chapters
                            elif '/chapters/' in endpoint:data={'content':f'# Chương {endpoint.rsplit("/",1)[1]}\n\nNội dung chương kiểm thử.'}
                            elif endpoint.endswith('/health'):data={'summary':{'total_raw':2,'total_translated':2},'issues':[]}
                            elif endpoint.endswith('/genres'):data=['Tiên hiệp']
                            elif endpoint.endswith('/auth/login'):data={'status':'success','token':'test-token'}
                            elif endpoint.endswith('/auth/verify'):data={'status':'valid'}
                            elif endpoint.endswith('/server-info'):data={'server_start':'2026-09-08T00:00:00Z','mode':'local'}
                            elif endpoint.endswith('/translate/status'):data={'status':'idle'}
                            elif endpoint.endswith('/logs'):data=[]
                            elif endpoint.endswith('/glossary'):data={'status':'success'}
                            elif any(x in endpoint for x in ['/comments','/catalog','/bookmarks','/progress','/novel-requests']):data=[]
                            route.fulfill(status=200,content_type='application/json',body=json.dumps(data,ensure_ascii=False))
                        context.route('**/*',handle)
                        page.goto(origin);expect(page.get_by_text('Truyện kiểm thử',exact=True).first).to_be_visible(timeout=15000)
                        page.goto(origin+'/novel/demo/read/1');expect(page.get_by_text('Nội dung chương kiểm thử.',exact=True)).to_be_visible()
                        page.keyboard.press('ArrowRight');expect(page).to_have_url(origin+'/novel/demo/read/2')
                        page.goto(origin+'/login');page.get_by_placeholder('Mật khẩu Admin').fill('test-password')
                        page.get_by_role('button',name='Đăng nhập',exact=False).click();expect(page).to_have_url(origin+'/admin')
                        expect(page.get_by_text('Không có phiên dịch nào đang chạy.',exact=True)).to_be_visible()
                        page.goto(origin+'/admin/novels')
                        expect(page.get_by_text('Quản lý 1 truyện trong hệ thống.' if shape=='local' else 'Quản lý 2 truyện trong hệ thống.',exact=True)).to_be_visible()
                        if shape=='cloud':expect(page.locator('a[href="/admin/novels/demo2"]')).to_be_visible()
                        page.goto(origin+'/admin/novels/demo');expect(page.get_by_text('Truyện kiểm thử',exact=True).first).to_be_visible()
                        page.goto(origin+'/novel/demo/epub-reader')
                        expect(page.locator('iframe').first).to_be_visible(timeout=15000)
                        page.goto(origin+'/library')
                        assert not errors,errors
                        assert not console_errors,console_errors
                        print(f'PASS browser {shape}: home, reader/navigation, admin login/detail, EPUB, cleanup')
                        context.close()
                finally:browser.close()
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait()
            log.close()


if __name__=='__main__':main()
