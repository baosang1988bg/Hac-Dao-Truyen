import base64
import pytest
from tools.reconcile_exports import reconcile


def test_reconcile_distinguishes_index_content_and_bundle_gaps():
    report = reconcile({
        'slug': 'demo',
        'chapters': [
            {'filename': '1.md', 'chapter_number': 1, 'r2_key': 'demo/content/one.md'},
            {'filename': '2.md', 'chapter_number': 2, 'r2_key': 'demo/missing'},
            {'filename': '4.md', 'chapter_number': 4, 'r2_key': 'demo/also-missing'},
        ],
        'catalog': [{'filename': '1.md', 'chapter_number': 10}, {'filename': '3.md', 'number': 3}],
        'object_keys': ['demo/content/one.md', 'demo/content/old.md', 'demo/bundles/a.json'],
        'manifest': {'2.md': 'demo/bundles/a.json'},
        'bundles': {'demo/bundles/a.json': {base64.urlsafe_b64encode(b'2.md').decode().rstrip('='): 'Chapter 2'}},
    })
    assert report['missing_index'] == ['3.md']
    assert report['missing_catalog'] == ['2.md', '4.md']
    assert report['missing_content'] == ['3.md', '4.md']
    assert report['bundle_fallback'] == ['2.md']
    assert report['chapter_number_mismatch'] == ['1.md']
    assert report['unreferenced_content_candidates'] == ['demo/content/old.md']


def test_inventory_does_not_prove_bundle_contains_chapter():
    report = reconcile({'slug':'demo','chapters':[{'filename':'1','r2_key':'demo/absent'}],
        'catalog':[],'object_keys':['demo/bundles/a'], 'manifest':{'1':'demo/bundles/a'}})
    assert report['bundle_unverified'] == ['1']
    assert report['bundle_fallback'] == []


def test_inventory_rejects_other_slug():
    with pytest.raises(ValueError):
        reconcile({'slug':'demo','chapters':[], 'catalog':[], 'object_keys':['other/content/a']})
