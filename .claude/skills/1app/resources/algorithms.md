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
1. pdfjs-dist `getTextContent()` mengekstrak text items beserta posisi (x, y, width, height, fontHeight)
2. **Row grouping (font-height adaptive):** tolerance = `max(5, fontHeight * 0.4)` — skala naik untuk header bold/besar
3. **Column boundary detection (4 teknik):**
   - Dual-edge boundary: untuk gap 5-60px, boundary di midpoint fisik antara `rightEdge(kiri)` dan `leftEdge(kanan)` — lebih akurat dari x-midpoint untuk kolom tahun yang rapat
   - Wide-gap fallback: untuk gap >60px, pakai x-midpoint biasa (right-aligned content bisa mulai jauh dari header)
   - Persistent gap detection: whitespace harus ada di ≥60% rows untuk dianggap column boundary — eliminasi false split dari label panjang yang punya spasi internal
4. **Number conversion (laporan keuangan Indonesia):**
   - Period-as-thousands: `"5.222.504"` → `5222504`
   - Parenthesized negatives (accounting notation): `"(5.222.504)"` → `-5222504`
   - Comma ambiguous: jika semua grup setelah koma persis 3 digit → thousands (`"10,114"` → `10114`); grup 1-2 digit tetap string
5. **Merged cell splitting:** `"66.086 Remeasurement..."` → number ke kolom value, text fragment ke kolom description (prepend jika kolom description sudah ada string)
6. Table construction → Excel export

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
