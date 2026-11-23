"""Merge a JSON file of new translations ({lang: {nested keys}}) into the locale files."""
import json, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'i18n' / 'locales'
def merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            merge(a[k], v)
        else:
            a[k] = v
new = json.load(open(sys.argv[1], encoding='utf-8'))
for lang, tree in new.items():
    p = root / f'{lang}.json'
    data = json.load(open(p, encoding='utf-8'))
    merge(data, tree)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('merged', ', '.join(new))
