"""Đối soát snapshot JSON offline; không có kết nối cloud hay thao tác sửa dữ liệu."""
import argparse
import base64
import json
from pathlib import Path


def reconcile(snapshot):
    slug = snapshot['slug']
    rows = snapshot['chapters']
    catalog = snapshot['catalog']
    objects = set(snapshot['object_keys'])
    manifest = snapshot.get('manifest', {})
    bundles = snapshot.get('bundles', {})
    if not isinstance(slug, str) or not slug or not isinstance(rows, list) or not isinstance(catalog, list):
        raise ValueError('Snapshot cần slug, chapters và catalog hợp lệ')
    if not all(isinstance(key, str) and key.startswith(slug + '/') for key in objects):
        raise ValueError('Inventory chỉ được chứa key thuộc slug đang đối soát')
    index = {}
    duplicates = []
    for row in rows:
        name = row['filename']
        if name in index:
            duplicates.append(name)
        index[name] = row
    legacy = {row['filename']: row for row in catalog}
    missing_content, bundle_unverified, bundle_fallback, mismatch = [], [], [], []
    referenced = set()
    for name in sorted(index.keys() | legacy.keys()):
        row = index.get(name)
        if row and name in legacy and row.get('chapter_number') != legacy[name].get('chapter_number', legacy[name].get('number')):
            mismatch.append(name)
        key = row.get('r2_key') if row else legacy[name].get('r2_key')
        if key:
            referenced.add(key)
        if key in objects:
            continue
        bundle_key = manifest.get(name)
        if bundle_key:
            referenced.add(bundle_key)
        if bundle_key and bundle_key in objects:
            encoded = base64.urlsafe_b64encode(name.encode()).decode().rstrip('=')
            if bundle_key not in bundles:
                bundle_unverified.append(name)
            elif isinstance(bundles[bundle_key].get(encoded), str):
                bundle_fallback.append(name)
            else:
                missing_content.append(name)
        else:
            missing_content.append(name)
    return {
        'slug': slug,
        'missing_index': sorted(legacy.keys() - index.keys()),
        'missing_catalog': sorted(index.keys() - legacy.keys()),
        'duplicate_index': sorted(set(duplicates)),
        'chapter_number_mismatch': mismatch,
        'missing_content': missing_content,
        'bundle_unverified': bundle_unverified,
        'bundle_fallback': bundle_fallback,
        # Chỉ xét object content/hash; glossary/EPUB/catalog không phải rác.
        'unreferenced_content_candidates': sorted(k for k in objects - referenced if k.startswith(slug + '/content/')),
        'limitations': 'Snapshot phải đầy đủ và cùng thời điểm. Không xác minh hash/body object riêng hoặc nguồn Drive; không tự xóa/backfill.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    args = parser.parse_args()
    report = reconcile(json.loads(args.snapshot.read_text(encoding='utf-8')))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return int(any(report[key] for key in ('missing_index', 'duplicate_index', 'chapter_number_mismatch', 'missing_content', 'bundle_unverified')))


if __name__ == '__main__':
    raise SystemExit(main())
