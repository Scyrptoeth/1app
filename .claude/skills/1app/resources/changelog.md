# 1APP — Changelog

> History perubahan lengkap. Entry terbaru di atas.

## 26 Maret 2026 — Word-to-PDF: Per-Font Width Correction + Justify Fix

### Refactor — font-specific width correction
- **Commit**: `ee44ed7`
- **Message**: `refactor(word-to-pdf): per-font width correction instead of global constant`
- **Perubahan**:
  - Hapus global `FONT_WIDTH_CORRECTION = 1.15` → ganti dengan `FONT_WIDTH_FACTORS` lookup table
  - Segoe UI/Verdana tetap dapat koreksi (`1.15`/`1.10`); Calibri, Arial, unknown → `1.0` (no correction)
  - Tambah `fontName: string` ke `DocxRun` dan `TextToken`, di-parse dari `w:rPr/w:rFonts`
  - `layoutWidth()` sekarang menerima `fontName` dan lookup per-token → koreksi per-karakter
  - Fix justify rendering: distribute extra space ke `lineWidthPt / avgFactor` (bukan `lineWidthPt` penuh) — mencegah over-wide spaces di paragraf justified Segoe UI
- **Hasil**: Dokumen Segoe UI tetap 7 halaman 287KB; Calibri/Arial tidak lagi over-wrap

---

## 26 Maret 2026 — Word-to-PDF: Phase 2 Complete Rewrite

### Fitur ke-8 — Word-to-PDF Converter (Phase 2: direct DOCX-to-PDF)
- **Commits**: `90dfe42`, `b5a8311`
- **File utama**: `src/lib/tools/word-to-pdf.ts`, `src/app/tools/word-to-pdf/page.tsx`
- **Perubahan arsitektur** — dari html2canvas ke direct DOCX parsing:
  - **Pipeline baru**: JSZip → DOMParser (OOXML) → Canvas image crop → jsPDF vector text
  - Text output sebagai PDF vector text (searchable, selectable, copyable) — bukan raster
  - Image crop via Canvas menggunakan `w:srcRect` (per-mille crop values dari OOXML)
- **Bug fixes dalam sesi**:
  - **`documentElement` bug**: `firstChild(docXml, W_NS, "body")` mencari di Document object (bukan root element) → PDF 3KB kosong. Fix: `firstChild(docXml.documentElement, W_NS, "body")`
  - **File size 14MB**: `canvas.toDataURL("image/png")` full-res RGBA. Fix: scale ke 2× display size + `toDataURL("image/jpeg", 0.85)` + white background → 287KB
  - **Double page-break (10 pages)**: P15/P30/P57/P73 punya `w:br type="column"` di run[0] DAN `w:lastRenderedPageBreak` di run[1] → 2 pageBreak items. Fix: `hasExplicitBreak` flag — scan semua runs di paragraf dulu; jika ada explicit break, semua lrpb diabaikan
  - **6 pages (harus 7)**: Default line height 1.15× terlalu kecil untuk Segoe UI (OS/2 metrics → 1.44×). Fix: `FONT_LINE_SPACING["Segoe UI"] = 1.44` dari paragraph-mark font (`pPr/rPr/rFonts`)
- **Hasil**: 7 halaman, 287 KB, teks searchable; match dengan benchmark Word

### Teknis utama word-to-pdf.ts:
- `FONT_LINE_SPACING`: lookup OS/2-based line height multiplier per font (Segoe UI = 1.44, default = 1.15)
- `FONT_WIDTH_FACTORS`: lookup width correction per font (Segoe UI = 1.15, default = 1.0)
- `hasExplicitBreak`: scan paragraph runs dulu sebelum process lrpb
- `cropAllImages`: scale 2×, JPEG @0.85, white background
- Segment-based page breaks: split items di `pageBreak` markers → render segmen terpisah

---

## 25 Maret 2026 (Sesi Lanjutan — PDF-to-PPT + Consistency Audit)

### PDF-to-PPT Converter (fitur ke-7) + 3-mode output + UI redesign
- **Commit**: (local — push ke GitHub saat siap deploy)
- **File baru**: `src/lib/tools/pdf-to-ppt.ts`, `src/app/tools/pdf-to-ppt/page.tsx`
- **Perubahan**:
  - Fix GAP C (color extraction): tambah `inTextBlock` flag di `analyzePageOperators()` — hanya tulis ke `colorMap` saat `inTextBlock=true` (BT/ET boundary), cegah background shape fills pollute text color map
  - Fix GAP D: hapus table detection (`TableBlock`, `detectTables`, `addTableToSlide`) yang menghasilkan invisible h=0 tables
  - Fix GAP A: tambah `groupLinesIntoParagraphs()` — merge adjacent lines (fontSize ±2pt, x ±0.3in, y-gap < 1.5× line height) menjadi satu `ParagraphBlock`, render sebagai 1 text box dengan `breakLine:true` antar-baris
  - Refactor `convertPdfToPpt()` → 3 pptx instances, render 1× per page (shared), 3 output branches:
    - **Hybrid**: background JPEG + white text overlay (`force='FFFFFF'`)
    - **Image Only**: background JPEG saja, tanpa text
    - **Text Only**: text boxes only; image fallback hanya untuk pure-image slides (`rawItems.length===0`)
  - `PdfToPptResult`: `{ hybridBlob, imageOnlyBlob, textOnlyBlob, pageCount, originalSize, qualityScore }`
  - `qualityScore = Math.round(slidesWithText / totalPages * 100)` — % slide dengan extractable text
  - `ColorOpts { force?, fallback }` + `effectiveTextColor()` helper — sanitize FFFFFF pada white bg
  - UI `pdf-to-ppt/page.tsx`: 3 download cards (bg-slate-50), emerald success icon, Data Quality badge, Info Notice, How it works (4-step grid)
- **Hasil**: Build ✅

### Consistency Audit — qualityScore + missing sections di semua tool pages
- **Perubahan lib files** (tambah `qualityScore: number` ke return type):
  - `image-watermark-remover.ts` → `qualityScore: 85` (heuristic)
  - `pdf-watermark-remover.ts` → `qualityScore: 90` (heuristic)
  - `pdf-to-word.ts` → `Math.round(pagesWithText / totalPages * 100)` (real tracking via `pagesWithText` counter di loop)
- **Perubahan page files** (tambah missing sections):
  - `image-to-excel/page.tsx` → tambah **Info Notice** setelah confidence badge
  - `image-watermark-remove/page.tsx` → wrap stage done dalam `<>`, tambah **Data Quality** + **Info Notice** setelah `<DownloadView />`
  - `pdf-to-excel/page.tsx` → tambah **Info Notice** setelah quality badge
  - `pdf-to-word/page.tsx` → tambah **Data Quality** + **Info Notice** sebelum amber formatting note
  - `pdf-watermark-remove/page.tsx` → tambah **Data Quality** + **Info Notice** setelah extra info block
- **Hasil**: Build ✅, semua 7 tool pages sekarang punya Data Quality badge + Info Notice + How it works

---

## 25 Maret 2026 (Sesi Lanjutan — Quality Improvements)

### PDF-to-Word — Layout Reconstruction + System Quality Fixes

#### Commit `4e6ea1d`
- **Message**: `fix(pdf-to-word): lower gap threshold to 0.15× to prevent word-merging` + `fix(pdf-to-excel): restore decimal digits lost in OCR dot-comma typo`
- **Perubahan**:
  - `src/lib/tools/pdf-to-word.ts` — `consolidateLineRuns` gap threshold: `0.25×` → `0.15×`
  - `src/lib/tools/pdf-to-excel.ts` — `correctNumericValue`: deteksi OCR decimal-comma typo, restore digit alih-alih strip
- **Detail fix pdf-to-word**: Threshold 0.25× (2.75pt untuk 11pt font) menyebabkan kata disambung ("SURATEDARAN"). Threshold 0.15× (1.65pt) lebih sensitif terhadap small inter-word gap tanpa mempengaruhi kerning (<0.5pt).
- **Detail fix pdf-to-excel**: OCR sering baca koma desimal Indonesia sebagai titik: `"1.234,56"` → `"1.234.56"`. Logic lama strip semua titik → `"123456"` (digit loss). Logic baru deteksi pattern (last group 1-2 digits + middle groups semua 3 digits) → rekonstruksi `"1234,56"`.
- **Hasil**: Build ✅, kedua fix di-push ke production

#### Commit `a3ed3b5`
- **Message**: `feat(pdf-to-word): add full-justify alignment and line-height normalization`
- **Perubahan**: `src/lib/tools/pdf-to-word.ts`
- **Teknik**:
  - `contentRight` = max qualifying cluster (≥2 lines) dari semua `maxX` → robust terhadap halaman dengan banyak indented lines
  - Full-justify detection: `line.maxX >= contentRight * 0.92` → `AlignmentType.BOTH` (docx `w:jc="both"`)
  - Line height: `spacing: { line: 240, lineRule: LineRuleType.AUTO }` (1.0× standard)
  - Centering check dipindah murni ke: `|lineCenter - pageCenter| < pageWidth * 0.02` (tanpa lineWidth check)
- **Hasil**: Build ✅

#### Commit `03512ae`
- **Message**: `feat(pdf-to-word): add indentation and y-gap spacing for text-based pages`
- **Perubahan**: `src/lib/tools/pdf-to-word.ts`
- **Teknik**:
  - `baseX` detection: cluster semua `line.minX` → ambil cluster terkiri dengan `x > 36` DAN `allMinX.some(x → |x - c| ≤ avgFontSize)` (at least 1 line)
  - `indentTWIPs = max(0, (line.minX - baseX) * 20)` → multi-level indentation
  - y-gap `spacingAfterTWIPs` dari selisih antar-baris: `lineSpacing - avgFontSize * 1.3`, clamped 40–360 TWIPs
- **Hasil**: Build ✅

---

## 25 Maret 2026

### PDF-to-Word Converter — Hybrid Adaptive (Fitur ke-6)
- **Perubahan**:
  - `src/lib/tools/pdf-to-word.ts` — algoritma lengkap Tasks 1-5
  - `src/app/tools/pdf-to-word/page.tsx` — halaman UI
  - `src/config/tools.ts` — entry pdf-to-word + masuk section "Convert from PDF"
  - Install npm package `docx@9.6.1`
- **Task 1**: PDF loading via pdfjs dynamic import + structured text extraction (font parsing dari transform matrix, bold/italic dari fontName)
- **Task 2**: docx paragraphs + formatting (bold, italic, font family mapping, font size, heading detection, center alignment heuristic) + page breaks
- **Task 3**: Table detection via x/y clustering heuristic — `clusterXPositions` → `isTableLikeLine` → `detectTables` → docx `Table` native
- **Task 4**: Scanned page detection → Tesseract OCR (Sauvola binarization) → if confidence ≥ 60% & words ≥ 10: text paragraphs, else: image embed via `ImageRun`
- **Task 5**: Layout reconstruction — paragraphs + tables sorted by y-position (PDF coordinate)
- **Hasil**: Build ✅, route `/tools/pdf-to-word` deployed, zero TypeScript errors
- **Library baru**: `docx@9.6.1`

---

## 24 Maret 2026

### Migration Preparation — Cowork to CLI
- **Perubahan**:
  - Dibuat HANDOFF.md untuk transisi state ke CLI
  - Dibuat design.md, plan.md, progress.md
  - Dibuat resources/ folder (algorithms.md, architecture.md, changelog.md, deployment.md)
  - Skill 1app dan update1app diadaptasi untuk CLI (hapus Cowork workaround)
- **Hasil**: Semua file transisi siap untuk CLI migration
- **Sesi**: "Cowork Migration Prep"

---

## Maret 2026 (Sesi-Sesi Cowork Sebelumnya)

### PDF-to-Excel Converter — Hybrid Approach
- **Perubahan**:
  - Implementasi hybrid extraction: pdfjs getTextContent() + OCR fallback
  - Sauvola adaptive binarization (window 15, k=0.15)
  - Dual PSM recognition (PSM 6 + PSM 4)
  - Fix Tesseract.js dynamic import (menyelesaikan page freeze)
- **Hasil**: Deployed, OCR berjalan tanpa hang. Belum ditest dengan PDF scanned asli.

### Image-to-Excel Converter — OCR + Column Detection
- **Perubahan**:
  - Tesseract.js v5 OCR (ind+eng)
  - X-coordinate clustering untuk column detection
  - Editable preview table sebelum Excel export
  - ExcelJS .xlsx generation dengan formatting
- **Hasil**: Production ready, deployed

### Image Watermark Removal — Ratio-Based Restoration
- **Perubahan**:
  - 4 iterasi development (simple threshold → adaptive → ratio-based → reverse alpha blending)
  - Canvas API implementation, zero dependencies
  - B-channel anchor untuk color fidelity
- **Hasil**: Production ready setelah iterasi ke-4

### PDF Watermark Removal — ExtGState Manipulation
- **Perubahan**:
  - pdf-lib ExtGState opacity detection dan neutralization
  - Content stream watermark removal
- **Hasil**: Production ready sejak iterasi pertama

---

> **Note:** Tanggal dan commit SHA untuk sesi-sesi Cowork sebelumnya tidak tercatat secara granular. Mulai dari CLI, setiap perubahan akan memiliki tanggal, commit SHA, dan message yang tepat.
