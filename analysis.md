# Analysis: image-to-excel.ts vs pdf-to-excel.ts

## 1. Manual Patches in image-to-excel.ts

These are ad-hoc corrections/adjustments instead of systematic processing:

### A. LABEL_CORRECTIONS (lines 119–154) — PRIMARY MANUAL PATCH
A hardcoded list of 30+ regex patterns targeting specific OCR misreads:
```
[/\bPernbellan\b/gi, 'Pembelian'],
[/\bPermbellan\b/gi, 'Pembelian'],
[/\bPernbelian\b/gi, 'Pembelian'],
... 30+ more patterns
```
**Problem**: Brittle. Only catches misreads we anticipated. Every new document type
may introduce new misreads not in the list. Scales poorly.

### B. Static Tesseract.js import (line 19) — KNOWN BUG
```ts
import { createWorker } from 'tesseract.js';  // STATIC — causes Next.js bundling failure
```
Known from skill context: static import causes webpack Web Worker bundling to fail,
leading to page freeze. Should be dynamic import with explicit CDN URLs.

### C. Hardcoded content area bounds (lines 1014–1015)
```ts
const contentStartY = imageHeight * 0.10;
const contentEndY = imageHeight * 0.78;
```
Fixed 10%–78% crops are arbitrary and will fail for images with different layouts.
No adaptive detection of where content actually starts/ends.

### D. `isHeader` heuristic (lines 1182–1185)
```ts
const isHeader =
  !hasValues &&
  (HEADER_KEYWORDS.some((kw) => upperLabel.includes(kw)) ||
    (/^[A-Z\s]+$/.test(upperLabel) && upperLabel.length > 5));
```
The all-caps heuristic `(/^[A-Z\s]+$/.test(upperLabel))` is fragile — wrongly flags
any label that happens to be typed in uppercase.

---

## 2. Framework in pdf-to-excel.ts Missing from image-to-excel.ts

### A. Dynamic import with explicit CDN URLs
pdf-to-excel:
```ts
let _createWorker: any = null;
async function getCreateWorker() {
  if (_createWorker) return _createWorker;
  const Tesseract = await import('tesseract.js');
  _createWorker = Tesseract.createWorker;
  return _createWorker;
}
// ...
const workerOpts = {
  workerPath: `${TESS_CDN}/worker.min.js`,
  corePath: `${CORE_CDN}/tesseract-core-simd-lstm.wasm.js`,
};
```
This avoids webpack bundling issues critical for Next.js deployment.

### B. Vocabulary-based OCR spell correction
pdf-to-excel has:
- `ID_FINANCIAL_VOCAB: Map<string, string>` — 100+ Indonesian financial terms
- `levenshtein()` — edit distance for fuzzy matching
- `correctOcrWord()` — unambiguous correction only (single closest match)
- `correctLabel()` — 5-step pipeline using structural regex + vocab spell correction +
  auto-capitalize + abbreviation normalization + hyphen normalization

This generalizes to ALL words in the vocabulary, not just the ones we anticipated.

### C. `user_defined_dpi` parameter in OCR
pdf-to-excel passes the actual DPI to Tesseract:
```ts
const dpi = String(Math.round(scaleFactor * 72));
await worker.setParameters({ user_defined_dpi: dpi as any });
```
This lets Tesseract calibrate internal character-size expectations. Skipping it means
Tesseract may size its internal models incorrectly.

### D. Parenthesized negative numbers in parseIndonesianNumber
pdf-to-excel handles `(1.234.567)` → `-1234567`:
```ts
const isNeg = s.startsWith('(') && s.endsWith(')');
if (isNeg) s = s.substring(1, s.length - 1);
```
Indonesian financial statements regularly use parentheses for negative values.

### E. Bias-aware column assignment (concept, not identical code)
pdf-to-excel's `extractTextTable` uses bias when assigning items to columns:
- Short numeric items: +10px rightward bias (harder to cross boundary)
- Long text descriptions: -15px leftward bias (easier to cross boundary)
image-to-excel's `assignToColumn` uses raw distance without any bias.

---

## 3. Components from pdf-to-excel TO ADAPT into image-to-excel

| Component | Adaptation Required |
|-----------|-------------------|
| Dynamic import + CDN URLs | Keep same pattern, image doesn't need scaleFactor for DPI calc — use `scale * 72` approximation |
| `ID_FINANCIAL_VOCAB` | Copy verbatim, same financial terms apply |
| `levenshtein()` | Copy verbatim |
| `correctOcrWord()` | Copy verbatim |
| `correctLabel()` 5-step pipeline | Adapt: keep structural regex, add vocab+spell correction, remove specific-word regex list |
| `parseIndonesianNumber()` parenthesized negatives | Adapt: add `(...)` detection |
| `user_defined_dpi` in OCR | Adapt: calculate from `scale * ~72` (phone camera equivalent) |
| Bias-aware column assignment | Adapt: add numeric/text bias to `assignToColumn` |

## 4. Components NOT to adapt (PDF-specific)

| Component | Why Not Applicable |
|-----------|-------------------|
| `pdfjs getTextContent()` path (Path A) | image-to-excel has no PDF, OCR is the only path |
| `renderPageToCanvas()` | image is already raster — no need to render PDF to canvas |
| `extractTextTable()` | uses pdfjs item widths and exact PDF coordinates |
| `preprocessCanvasForOcr()` with scaleFactor | image-to-excel already has a richer preprocessing pipeline (CLAHE + morphological opening) |
| `detectPageTypeFromOcr()` | unnecessary for single image input |
| `parseLabaRugiFromOcrWords()` / `parseNeracaFromOcrWords()` | pdf-to-excel's specialized page parsers; image-to-excel uses generic layout analysis |
| `generateExcel()` multi-sheet logic | image-to-excel needs single-sheet output; keep existing format |

---

## Summary of Changes Needed

1. **CRITICAL (BUG FIX)**: Static → dynamic Tesseract import with CDN URLs
2. **HIGH**: Remove `LABEL_CORRECTIONS` regex list, add `ID_FINANCIAL_VOCAB` + `levenshtein` + `correctOcrWord` + upgraded `correctLabel()`
3. **MEDIUM**: Add parenthesized negative to `parseIndonesianNumber()`
4. **MEDIUM**: Add `user_defined_dpi` to OCR parameters
5. **LOW**: Add bias-aware column assignment in `assignToColumn()`
