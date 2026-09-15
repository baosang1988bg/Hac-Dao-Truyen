"""Fetch publisher rankings through Jina; sync only successfully parsed combos.

Run: python tools/fetch_rankings.py [--dry-run]
Source verification and unsupported sources: docs/external-rankings.md.
"""
import argparse
from collections import defaultdict
from datetime import datetime
import http.client
import json
import logging
import os
from pathlib import Path
import re
import sys
import time
import urllib.request
from zoneinfo import ZoneInfo

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.sync_transport import send_sync_request

LOG = logging.getLogger(__name__)
RANKING_SOURCES = [
    {"source": "qidian", "category": "recommend", "window": "monthly",
     "rank_url": "https://www.qidian.com/rank/yuepiao/", "parser": "parse_qidian_rank"},
    {"source": "qidian", "category": "recommend", "window": "weekly",
     "rank_url": "https://www.qidian.com/rank/recom/", "parser": "parse_qidian_rank"},
    {"source": "qidian", "category": "follows", "window": "all_time",
     "rank_url": "https://www.qidian.com/rank/collect/", "parser": "parse_qidian_rank"},
    {"source": "qidian", "category": "views", "window": "daily",
     "rank_url": "https://www.qidian.com/rank/hotsales/", "parser": "parse_qidian_rank"},
    {"source": "faloo", "category": "views", "window": "weekly",
     "rank_url": "https://b.faloo.com/y_0_0_0_0_0_1_1.html", "parser": "parse_faloo_rank"},
    {"source": "faloo", "category": "views", "window": "monthly",
     "rank_url": "https://b.faloo.com/y_0_0_0_0_0_2_1.html", "parser": "parse_faloo_rank"},
]
# No invented daily/quarterly windows for pages that do not publish them.
UNAVAILABLE_SOURCES = {
    '69shuba': 'click ranking found, but its time window is not published in Jina output',
    'novel543': 'no verified ranking URL (homepage is recent books; /top/ returns 404)',
    'fanqie': 'Jina /rank lacks book links and contains font-obfuscated titles',
}


def _match(pattern, text):
    match = re.search(pattern, text, re.M)
    return match.group(1).strip() if match else ''


def _item(rank, title, url, author='', cover='', stat=''):
    return dict(rank=int(rank), title=title.strip(), source_url=url,
                author=author, cover_url=cover, stat_label=stat)


def parse_qidian_rank(text):
    """Qidian: numbered list items with inline H2 book title and author link."""
    if not re.search(r'### (?:月票榜|推荐榜|收藏榜|畅销榜)', text):
        raise ValueError('Qidian ranking heading missing')
    items = []
    for block in re.split(r'(?m)^\*\s+(?=\d+\[)', text)[1:]:
        title = re.search(r'## \[([^\]]+)\]\((https://www\.qidian\.com/book/\d+/)(?: "[^"]*")?\)', block)
        rank = re.match(r'(\d+)', block)
        if not title or not rank:
            raise ValueError('Qidian ranking item changed')
        # Font-obfuscated counts are not decipherable from Reader text: omit them.
        stat = _match(r'\s([\d.,万萬亿億]+\s*(?:月票|推荐))\s*$', block)
        items.append(_item(rank[1], title[1], title[2],
                           _match(r'\[([^\]]+)\]\(https://my\.qidian\.com/author/', block),
                           _match(r'!\[[^\]]*\]\((https://bookcover\.[^\s)]+)\)', block), stat))
        if len(items) == 20:
            break
    return items


def parse_69shuba_rank(text):
    """69shuba hot page: ordered cover/title cards; window must be verified separately."""
    if '点击排行榜' not in text:
        raise ValueError('69shuba ranking heading missing')
    items = []
    for block in re.split(r'(?m)^\*\s+(?=\[!\[)', text)[1:]:
        title = re.search(r'### \[([^\]]+)\]\((https://www\.69shuba\.com/book/\d+\.htm)\)', block)
        if not title:
            raise ValueError('69shuba ranking card changed')
        items.append(_item(len(items) + 1, title[1], title[2],
                           _match(r'^(.+?) (?:连载|完结|完本)\s*$', block),
                           _match(r'!\[[^\]]*\]\((https?://[^\s)]+)\)', block)))
        if len(items) == 20:
            break
    return items


def parse_novel543_rank(text):
    """Reject homepage/latest-book lists; accept only explicitly numbered ranking rows."""
    if not re.search(r'(?m)^#{1,3} .*?(?:排行榜|排行榜單)', text):
        raise ValueError('Novel543 has no verified ranking heading')
    items = []
    for rank, title, url in re.findall(
            r'(?m)^\s*(\d+)\.\s+\[([^\]]+)\]\((https://www\.novel543\.com/\d+/)\)', text):
        items.append(_item(rank, title, url))
    return items[:20]


def parse_fanqie_rank(text):
    """Fanqie rank cards need readable titles and explicit /page/ book links."""
    items = []
    for block in re.split(r'(?m)^## (?=\d+\s*$)', text)[1:]:
        rank = re.match(r'\d+', block)
        title = re.search(r'\[([^\]]+)\]\((https://fanqienovel\.com/page/\d+)\)', block)
        if not title or re.search(r'[\ue000-\uf8ff]', title[1]):
            raise ValueError('Fanqie title is obfuscated or book link is missing')
        items.append(_item(rank[0], title[1], title[2],
                           _match(r'作者[：:]\s*(.+)', block),
                           _match(r'!\[[^\]]*\]\((https?://[^\s)]+)\)', block)))
        if len(items) == 20:
            break
    return items


def parse_faloo_rank(text):
    """Faloo: H1 book cards, ignoring header promotions and chapter links."""
    if not re.search(r'小说库.*(?:周|月)点击小说', text):
        raise ValueError('Faloo ranking heading missing')
    starts = list(re.finditer(r'(?m)^\[!\[Image [^\n]+\n\s*\n# \[', text))
    items = []
    for i, start in enumerate(starts):
        block = text[start.start():starts[i + 1].start() if i + 1 < len(starts) else len(text)]
        title = re.search(r'^# \[([^\]]+)\]\((https://b\.faloo\.com/\d+\.html)(?: "[^"]*")?\)', block, re.M)
        if not title:
            raise ValueError('Faloo book card changed')
        items.append(_item(len(items) + 1, title[1], title[2],
                           _match(r'\[([^\]]+)\]\(https://b\.faloo\.com/l_0_1\.html\?t=2', block),
                           _match(r'!\[[^\]]*\]\((https?://img\.faloo\.com/[^\s)]+)\)', block),
                           _match(r'((?:周|月)点击[：:]\s*[\d.,万億亿]+)', block)))
        if len(items) == 20:
            break
    return items


def _make_gemini_backend():
    from providers.gemini import GeminiBackend
    return GeminiBackend()


def translate_entries_vi(entries, make_backend=_make_gemini_backend):
    """Dịch title/author sang tiếng Việt bằng Gemini (key có sẵn cho pipeline dịch chương).
    Không có key, lỗi mạng, hay phản hồi không hợp lệ đều fallback về văn bản gốc —
    dịch chỉ là tiện ích thêm, không được phép chặn việc sync bảng xếp hạng."""
    if not entries:
        return entries
    try:
        backend = make_backend()
    except Exception as exc:
        LOG.warning('Translation skipped: %s', exc)
        return entries
    payload = [{'title': e['title'], 'author': e['author']} for e in entries]
    prompt = (
        'Dịch sang tiếng Việt trường "title" và "author" của mỗi phần tử JSON sau '
        '(tên người dịch phiên âm Hán Việt nếu là tên riêng). Chỉ trả về đúng một mảng '
        'JSON cùng độ dài, cùng thứ tự, dạng [{"title":"...","author":"..."}], '
        'không thêm chữ giải thích nào khác.\n\n' + json.dumps(payload, ensure_ascii=False)
    )
    try:
        match = re.search(r'\[.*\]', backend.call(prompt), re.S)
        translated = json.loads(match.group(0)) if match else []
        if len(translated) != len(entries):
            raise ValueError('translated length mismatch')
    except Exception as exc:
        LOG.warning('Translation failed, keeping original text: %s', exc)
        return entries
    for entry, item in zip(entries, translated):
        if isinstance(item, dict):
            if item.get('title'):
                entry['title'] = str(item['title']).strip()
            if item.get('author'):
                entry['author'] = str(item['author']).strip()
    return entries


def fetch_markdown(url):
    request = urllib.request.Request('https://r.jina.ai/' + url,
                                     headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        text = response.read().decode('utf-8')
    if re.search(r'Warning: Target URL returned error|captcha|Just a moment', text, re.I):
        raise ValueError('Source returned an error/challenge page')
    return text


def sync_via_worker_api(payload, *, sleep=time.sleep):
    """Same HTTPS transport and bounded retry policy as novel sync, without chapter budgets."""
    key = os.getenv('HACDAO_SYNC_KEY', '').strip()
    if not key:
        raise ValueError('Missing HACDAO_SYNC_KEY')
    host = os.getenv('HACDAO_SYNC_HOST', 'hac-dao-truyen.nguyenbaosang1998.workers.dev')
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    conn = None
    last_error = 'Sync failed'
    try:
        for attempt in range(5):
            delay = min(60, 2 ** attempt)
            try:
                conn, response, text = send_sync_request(conn, '/api/admin/sync-rankings', body, host=host, sync_key=key)
                if response.status == 200:
                    result = json.loads(text)
                    if result.get('upserted') != len(payload['entries']) or result.get('skipped') != 0:
                        raise ValueError('Worker did not accept all ranking entries')
                    return result
                last_error = f'HTTP {response.status}'
                if response.status not in (429, 500, 502, 503, 504):
                    raise RuntimeError(last_error)
                retry = response.getheader('Retry-After')
                if retry and retry.isdigit():
                    delay = min(120, max(delay, int(retry)))
            except (OSError, http.client.HTTPException, ValueError) as exc:
                last_error = str(exc)
            if conn:
                conn.close()
                conn = None
            if attempt < 4:
                sleep(delay)
        raise RuntimeError(last_error)
    finally:
        if conn:
            conn.close()


def collect_rankings(sources=None, fetch=fetch_markdown):
    batches = defaultdict(list)
    for config in RANKING_SOURCES if sources is None else sources:
        combo = '/'.join(config[k] for k in ('source', 'category', 'window'))
        try:
            items = globals()[config['parser']](fetch(config['rank_url']))
            if not items or [item['rank'] for item in items] != list(range(1, len(items) + 1)):
                raise ValueError('Empty or non-contiguous ranking; retaining old snapshot')
            if len({item['source_url'] for item in items}) != len(items):
                raise ValueError('Duplicate books; ranking format may have changed')
            batches[config['source']].extend(dict(item, category=config['category'], window=config['window']) for item in items)
            LOG.info('%s: %d items', combo, len(items))
        except Exception as exc:
            LOG.warning('%s skipped: %s', combo, exc)
    return batches


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Fetch and parse without writing to Worker')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    if not args.dry_run and not os.getenv('HACDAO_SYNC_KEY', '').strip():
        LOG.error('Missing HACDAO_SYNC_KEY')
        return 1
    for source, reason in UNAVAILABLE_SOURCES.items():
        LOG.warning('%s disabled: %s', source, reason)
    snapshot = datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).date().isoformat()
    batches = collect_rankings()
    failed = not batches
    for source, entries in batches.items():
        translate_entries_vi(entries)
        if args.dry_run:
            LOG.info('Dry run: %s would sync %d entries', source, len(entries))
            continue
        try:
            result = sync_via_worker_api(dict(source=source, snapshot_date=snapshot, entries=entries))
            LOG.info('%s synced: %s', source, result)
        except Exception as exc:
            failed = True
            LOG.error('%s sync failed: %s', source, exc)
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
