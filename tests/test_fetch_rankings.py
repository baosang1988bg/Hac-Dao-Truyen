from pathlib import Path
from unittest.mock import Mock
import pytest
from tools import fetch_rankings as rankings

FIXTURES = Path(__file__).parent / 'fixtures' / 'rankings'


def fixture(name):
    return (FIXTURES / f'{name}.md').read_text()


@pytest.mark.parametrize('name,parser,title,author', [
    ('qidian', rankings.parse_qidian_rank, '夜无疆', '辰东'),
    ('69shuba', rankings.parse_69shuba_rank, '女总裁的贴身高手', '8难'),
    ('faloo', rankings.parse_faloo_rank, '名义：水木圣子，从中枢开始进部', '邪恶手动挡'),
])
def test_observed_cards(name, parser, title, author):
    items = parser(fixture(name))
    assert [i['rank'] for i in items] == [1, 2]
    assert items[0]['title'] == title
    assert items[0]['author'] == author
    assert items[0]['cover_url'].startswith('http')
    assert items[0]['source_url'].startswith('https://')


def test_qidian_counts_and_obfuscated_numbers():
    items = rankings.parse_qidian_rank(fixture('qidian'))
    assert items[0]['stat_label'] == '1234 月票'
    assert items[1]['stat_label'] == ''


@pytest.mark.parametrize('name,parser', [
    ('novel543', rankings.parse_novel543_rank),
    ('fanqie', rankings.parse_fanqie_rank),
])
def test_unsupported_observed_pages_fail_closed(name, parser):
    with pytest.raises(ValueError):
        parser(fixture(name))


@pytest.mark.parametrize('parser', [rankings.parse_qidian_rank, rankings.parse_69shuba_rank,
                                    rankings.parse_faloo_rank, rankings.parse_fanqie_rank,
                                    rankings.parse_novel543_rank])
def test_error_pages_never_produce_rankings(parser):
    try:
        assert parser('Warning: Target URL returned error 403: Forbidden') == []
    except ValueError:
        pass


def test_one_combo_failure_does_not_remove_other_combos(caplog):
    sources = [dict(rankings.RANKING_SOURCES[0]), dict(rankings.RANKING_SOURCES[1])]
    fetch = Mock(side_effect=[TimeoutError('timeout'), fixture('qidian')])
    batches = rankings.collect_rankings(sources, fetch)
    assert len(batches['qidian']) == 2
    assert {i['window'] for i in batches['qidian']} == {'weekly'}
    assert 'timeout' in caplog.text


def test_non_contiguous_or_duplicate_items_are_rejected():
    text = fixture('qidian').replace('*   2[', '*   4[')
    assert not rankings.collect_rankings([rankings.RANKING_SOURCES[0]], lambda _: text)


def test_top_twenty_limit():
    text = fixture('qidian')
    first = text[text.index('*   1['):text.index('*   2[')]
    text = '### 月票榜\n' + ''.join(first.replace('*   1[', f'*   {i}[') for i in range(1, 26))
    assert len(rankings.parse_qidian_rank(text)) == 20


def test_sync_retries_and_sends_same_payload(monkeypatch):
    monkeypatch.setenv('HACDAO_SYNC_KEY', 'test-key')
    conn = Mock()
    response = Mock(status=429)
    response.getheader.return_value = '3'
    transport = Mock(side_effect=[(conn, response, ''),
                                 (conn, Mock(status=200), '{"upserted":1,"skipped":0}')])
    monkeypatch.setattr(rankings, 'send_sync_request', transport)
    sleep = Mock()
    result = rankings.sync_via_worker_api({'entries': [{}]}, sleep=sleep)
    assert result['upserted'] == 1
    sleep.assert_called_once_with(3)
    assert transport.call_args_list[0].args[1] == '/api/admin/sync-rankings'
    assert transport.call_args_list[0].args[2] == transport.call_args_list[1].args[2]
    assert conn.close.call_count == 2


@pytest.mark.parametrize('heading', ['收藏榜 历史总作品收藏数排行', '畅销榜 本日作品销量排行'])
def test_qidian_accepts_collect_and_hotsales_headings(heading):
    text = fixture('qidian').replace('### 月票榜', f'### {heading}')
    items = rankings.parse_qidian_rank(text)
    assert [i['rank'] for i in items] == [1, 2]


def test_translate_entries_vi_replaces_title_and_author():
    entries = [{'title': '夜无疆', 'author': '辰东'}]
    backend = Mock()
    backend.call.return_value = '[{"title": "Dạ Vô Cương", "author": "Thần Đông"}]'
    result = rankings.translate_entries_vi(entries, make_backend=lambda: backend)
    assert result[0]['title'] == 'Dạ Vô Cương'
    assert result[0]['author'] == 'Thần Đông'


@pytest.mark.parametrize('make_backend,call_result', [
    (lambda: (_ for _ in ()).throw(RuntimeError('no key')), None),
    (lambda: Mock(call=Mock(return_value='not json')), None),
    (lambda: Mock(call=Mock(return_value='[{"title": "A"}]')), None),
])
def test_translate_entries_vi_falls_back_to_original_on_any_failure(make_backend, call_result):
    entries = [{'title': '夜无疆', 'author': '辰东'}, {'title': '玄鉴仙族', 'author': '季越人'}]
    result = rankings.translate_entries_vi(entries, make_backend=make_backend)
    assert result[0]['title'] == '夜无疆' and result[0]['author'] == '辰东'


def test_sync_unauthorized_is_not_retried(monkeypatch):
    monkeypatch.setenv('HACDAO_SYNC_KEY', 'test-key')
    transport = Mock(return_value=(Mock(), Mock(status=401), ''))
    monkeypatch.setattr(rankings, 'send_sync_request', transport)
    with pytest.raises(RuntimeError, match='401'):
        rankings.sync_via_worker_api({'entries': []})
    assert transport.call_count == 1
