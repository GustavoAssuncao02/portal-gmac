import json
from pathlib import Path

import pymupdf as fitz


directory = Path('test-results/document-review')
results = []
for filename in sorted(directory.glob('*.pdf')):
    document = fitz.open(filename)
    pages = []
    for index, page in enumerate(document):
        spans = [span for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for span in line['spans'] if span['text'].strip()]
        assert spans, f'{filename}: blank page {index + 1}'
        assert any(85 < span['bbox'][1] < page.rect.height - 48 for span in spans), f'{filename}: page with only header/footer {index + 1}'
        assert any('GMAC' in span['text'] and span['bbox'][1] < 70 for span in spans), f'{filename}: missing repeated header'
        if filename.stem == 'payables-individual' and 'Hist' in page.get_text():
            assert 'criada' in page.get_text(), f'{filename}: table heading separated from its first row'
        for span in spans:
            box = fitz.Rect(span['bbox'])
            assert box.x0 >= 30 and box.x1 <= page.rect.width - 30, f'{filename}: horizontal clipping: {span}'
            assert box.y0 >= 18 and box.y1 <= page.rect.height - 18, f'{filename}: vertical clipping: {span}'
            if box.y0 > 85 and box.y0 < page.rect.height - 48:
                assert span['size'] >= 9, f'{filename}: unreadable body font: {span}'
        for position, span in enumerate(spans):
            for other in spans[position + 1:]:
                intersection = fitz.Rect(span['bbox']) & fitz.Rect(other['bbox'])
                assert intersection.width < 2 or intersection.height < 2, f'{filename}: overlapping text: {span["text"]} / {other["text"]}'
        pages.append(len(spans))
        if index == 0 or index == len(document) - 1:
            page.get_pixmap(matrix=fitz.Matrix(1.4, 1.4)).save(directory / f'{filename.stem}-page-{index + 1}.png')
    results.append({'file': filename.name, 'pages': len(document), 'text_spans': pages})
    if filename.stem == 'long-text':
        assert 'MARCADOR FINAL INTEGRAL' in ''.join(page.get_text() for page in document)
        assert 'REG-60' in ''.join(page.get_text() for page in document)
assert len(results) >= 12
(directory / 'pdf-layout-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(f'PDF layout audit: {len(results)} documents, {sum(len(row["text_spans"]) for row in results)} pages; no clipped, overlapping or blank content.')
