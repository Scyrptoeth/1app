# 1APP — Algorithm Reference

> Detail teknis algoritma setiap tool. Baca file ini saat mengembangkan atau debug algoritma.

## 1. PDF Watermark Removal — ExtGState Opacity Manipulation

**Library:** pdf-lib (client-side)

**Cara kerja:**
1. Parse PDF dengan pdf-lib
2. Iterate semua pages, akses resources dictionary
3. Cari ExtGState entries — ini adalah graphics state objects yang mengontrol opacity
4. Identifikasi ExtGState dengan `/CA` (stroke opacity) atau `/ca` (fill opacity) < 1.0
5. Set opacity values ke 0.0 (invisible) — efektif menghilangkan watermark
6. Scan content streams untuk operator yang mereferensikan watermark graphics state
7. Remove atau neutralize operator tersebut dari content stream
8. Serialize modified PDF

**Key insight:** Watermark biasanya diaplikasikan sebagai overlay dengan opacity rendah menggunakan ExtGState. Dengan menetralisasi opacity, watermark menjadi invisible tanpa merusak content di bawahnya.

**Edge cases:**
- Beberapa PDF generator menyimpan watermark sebagai XObject, bukan inline content stream
- Watermark bisa di-apply per-page atau sebagai page template
- Encrypted PDFs memerlukan decryption sebelum manipulation

## 2. Image Watermark Removal — Ratio-Based Color Restoration

**Library:** Canvas API (zero dependencies)

**Cara kerja:**
1. Load image ke Canvas, ambil pixel data (RGBA array)
2. Analisis pixel: hitung rasio R/B dan G/B untuk setiap pixel
3. Identifikasi watermark pixels — pixel yang memiliki rasio R/B dan G/B yang terdisrupted secara konsisten (menyimpang dari expected ratio untuk area tersebut)
4. Untuk setiap watermark pixel, reverse alpha blending:
   - Channel B dijadikan anchor (tidak diubah)
   - Channel R dan G di-restore berdasarkan rasio yang diharapkan
   - Formula: `restored_R = (observed_R - watermark_R * alpha) / (1 - alpha)`
5. Output: restored image dengan watermark dihilangkan

**Mengapa ratio-based, bukan pixel replacement:**
- Inpainting (neighbor averaging) menghancurkan warna asli dan menciptakan blur artifacts
- Pixel replacement membutuhkan "clean" reference yang tidak tersedia
- Ratio-based restoration mempertahankan detail warna asli karena bekerja pada channel individu
- Hanya R dan G yang dimodifikasi, B tetap sebagai anchor — menjaga color fidelity

**Iterasi development:**
- Iterasi 1: Simple threshold → gagal (terlalu agresif)
- Iterasi 2: Adaptive threshold → lebih baik tapi masih artifacts di edges
- Iterasi 3: Ratio-based detection → breaktrhough (menemukan disruption pattern)
- Iterasi 4: Reverse alpha blending dengan B-channel anchor → production ready

## 3. Image-to-Excel — OCR + X-Coordinate Clustering

**Libraries:** Tesseract.js v5 (OCR), ExcelJS (xlsx generation)

**Cara kerja:**
1. **OCR**: Tesseract.js memproses image, output: array of words dengan bounding box (x, y, width, height)
2. **Column detection**: X-coordinate clustering — grup kata berdasarkan posisi horizontal (`x`). Kata-kata yang memiliki x-coordinate dekat satu sama lain dianggap satu kolom
3. **Row detection**: Y-coordinate grouping — kata-kata pada baris yang sama memiliki y-coordinate serupa
4. **Table construction**: Mapping (row, column) → cell content
5. **Editable preview**: Tampilkan tabel di UI, user bisa edit sebelum export
6. **Excel export**: ExcelJS generate .xlsx dengan formatting

**Tesseract.js setup (CRITICAL):**
```typescript
// WAJIB dynamic import — static import menyebabkan page freeze
const Tesseract = await import('tesseract.js');

// WAJIB explicit CDN URLs
const worker = await Tesseract.createWorker('ind+eng', 1, {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
  langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
});
```

**X-coordinate clustering algorithm:**
- Collect all x-coordinates dari OCR output
- Sort x-coordinates
- Identify gaps > threshold sebagai column boundaries
- Threshold ditentukan adaptively dari distribusi x-coordinates

## 4. PDF-to-Excel — Hybrid pdfjs + OCR Fallback

**Libraries:** pdfjs-dist v4, Tesseract.js v5, ExcelJS v4

**Cara kerja (hybrid):**

**Path A — Text-based PDF:**
1. pdfjs-dist `getTextContent()` mengekstrak text items beserta posisi (x, y, width, height)
2. Column detection via x-coordinate clustering (sama seperti Image-to-Excel)
3. Row detection via y-coordinate grouping
4. Table construction → Excel export

**Path B — Scanned/Image PDF (OCR fallback):**
1. pdfjs-dist render page ke Canvas (high DPI: scale 2.0-3.0)
2. **Sauvola adaptive binarization** pada Canvas image data:
   - Window size: 15px
   - k parameter: 0.15
   - Formula: `T(x,y) = mean(x,y) * (1 + k * (stdev(x,y) / R - 1))`
   - R = 128 (half of dynamic range for 8-bit image)
3. Tesseract.js OCR pada binarized image
4. **Dual PSM recognition:**
   - PSM 6 (assume single block of text) — untuk tabel terstruktur
   - PSM 4 (assume single column of text) — untuk tabel general
   - Pilih hasil dengan confidence lebih tinggi
5. Column/row detection → Table construction → Excel export

**Detection logic (text-based vs scanned):**
- Jalankan `getTextContent()` terlebih dahulu
- Jika jumlah text items > threshold → text-based (Path A)
- Jika sedikit/kosong → scanned (Path B, OCR fallback)

**Sauvola vs Otsu:**
- Otsu: global threshold, gagal pada pencahayaan tidak rata
- Sauvola: local adaptive, menghitung threshold per-pixel berdasarkan mean dan stdev area sekitarnya
- Sauvola jauh lebih stabil untuk dokumen scanned real-world

## 5. PDF-to-Word — Hybrid Layout Reconstruction

**Library:** pdfjs-dist (text extraction), docx@9.6.1 (Word generation), Tesseract.js v5 (OCR fallback)

**Cara kerja:**

**Path A — Text-based PDF:**
1. pdfjs-dist `getTextContent()` → text items dengan `transform` matrix (posisi x,y + font size)
2. Font bold/italic detection dari `fontName` string (`/bold|heavy|black|demi/i`, `/italic|oblique|slant/i`)
3. Group items ke lines via y-coordinate clustering (threshold: `max(prevFontSize, itemFontSize) * 0.45`)
4. `consolidateLineRuns`: gabungkan items sejajar, insert space jika `gap > prev.fontSize * 0.15`
5. **baseX detection**: cluster semua `line.minX` dengan tolerance `avgFontSize * 0.5` → ambil cluster terkiri dengan `c > 36` AND `allMinX.some(x → |x - c| ≤ avgFontSize)` → margin halaman
6. **Indentation**: `indentTWIPs = max(0, (line.minX - baseX) * 20)` → multi-level indent dalam TWIP
7. **Centering detection**: `|lineCenter - pageCenter| < pageWidth * 0.02` (2% threshold — PDF engines center precisely)
8. **contentRight**: cluster semua `line.maxX` → ambil cluster terkanan yang memiliki ≥2 lines → right margin
9. **Full-justify detection**: `!isCentered && line.maxX >= contentRight * 0.92` → `AlignmentType.BOTH`
10. **y-gap spacing**: `lineSpacing - avgFontSize * 1.3` → `spacingAfterTWIPs` (clamp 40–360)
11. Table detection via `clusterXPositions` → `isTableLikeLine` → `detectTables` → docx `Table`
12. Layout reconstruction: elements sorted by y-position (PDF coord top=high, bottom=low)

**Path B — Scanned PDF (OCR fallback):**
1. Detect scanned page: `rawItems.length < 5`
2. Render page ke Canvas (scale 1.5)
3. Sauvola adaptive binarization (window 15, k=0.15)
4. Tesseract OCR PSM 3 (auto-detect layout)
5. Jika `confidence ≥ 60 AND wordCount ≥ 10`: text paragraphs
6. Else: embed page sebagai `ImageRun` (preserves appearance)

**Key decisions:**
- `consolidateLineRuns` threshold `0.15×` (bukan 0.25×): mencegah word-merging. Kerning <0.5pt, word spacing 2-4pt, threshold 1.65pt memisahkan keduanya.
- `baseX` menggunakan "at least 1 occurrence" bukan percentage: section headers (1× per halaman) tidak boleh diabaikan
- `contentRight` = max qualifying cluster bukan mode: halaman dengan banyak indented lines tidak underestimate right margin
- Centering check tanpa lineWidth: short text ("SURAT EDARAN") tetap terdeteksi sebagai centered
