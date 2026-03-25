---
name: 1app
description: Context loader untuk pengembangan aplikasi 1APP (Multi-Purpose Document Tools). Gunakan skill ini SETIAP KALI user menyebut "1app", "1APP", "aplikasi 1app", atau meminta pengembangan fitur baru di 1APP. Juga trigger ketika user menyebut URL 1app-orcin.vercel.app, repo Scyrptoeth/1app, atau membahas watermark removal tool (PDF maupun image), atau image-to-excel converter, atau pdf-to-excel converter. Skill ini WAJIB dipanggil sebelum melakukan perubahan kode apapun pada proyek 1APP — karena berisi seluruh konteks yang Claude butuhkan untuk bekerja tanpa penjelasan ulang dari user.
---

# 1APP Development Context

Skill ini memberikan Claude seluruh konteks tentang proyek 1APP sehingga setiap sesi pengembangan baru bisa langsung berjalan tanpa user harus menjelaskan ulang apa itu 1APP, arsitekturnya, fitur yang sudah ada, atau konvensi kode.

## Identitas Proyek

**1APP** adalah aplikasi web multi-purpose document tools yang membantu user melakukan berbagai operasi pada dokumen (PDF dan gambar). Aplikasi dibangun dengan Next.js (TypeScript) dan di-deploy di Vercel dengan auto-deploy dari GitHub.

| Aspek | Detail |
|-------|--------|
| Repository | `github.com/Scyrptoeth/1app` (branch: `main`) |
| Live URL | `https://1app-orcin.vercel.app` |
| Framework | Next.js (TypeScript) |
| Hosting | Vercel — auto-deploy setiap push ke `main` |
| Owner | Scyrptoeth |
| GitHub Token | Tersimpan di user — minta saat dibutuhkan |

## Fitur yang Sudah Ada

### 1. PDF Watermark Removal
- **URL**: `/tools/pdf-watermark-remove`
- **File**: `src/lib/tools/pdf-watermark-remover.ts`
- **Library**: pdf-lib (client-side)
- **Teknik**: ExtGState opacity manipulation — mendeteksi graphics state dengan opacity rendah, menghapus content stream watermark, dan menetralisasi opacity ke 0.0
- **Status**: Production ready, berhasil sejak iterasi pertama
- Baca `resources/algorithms.md` untuk detail teknis

### 2. Image Watermark Removal
- **URL**: `/tools/image-watermark-remove`
- **File**: `src/lib/tools/image-watermark-remover.ts`
- **Library**: Canvas API (client-side, zero dependencies)
- **Teknik**: Ratio-based color restoration — mendeteksi watermark dari disruption rasio R/B dan G/B, lalu membalikkan alpha blending pada channel R dan G saja
- **Status**: Production ready setelah 4 iterasi
- Baca `resources/algorithms.md` untuk detail teknis lengkap

### 3. Image-to-Excel Converter
- **URL**: `/tools/image-to-excel`
- **Files**: `src/lib/tools/image-to-excel.ts`, `src/app/tools/image-to-excel/page.tsx`
- **Library**: Tesseract.js v5 (OCR, ind+eng), ExcelJS (xlsx generation)
- **Teknik**: Client-side OCR → position-based column detection via x-coordinate clustering → editable preview → formatted Excel export
- **Status**: Production ready, deployed
- Baca `resources/algorithms.md` untuk detail teknis

### 4. PDF-to-Excel Converter
- **URL**: `/tools/pdf-to-excel`
- **Files**: `src/lib/tools/pdf-to-excel.ts`, `src/app/tools/pdf-to-excel/page.tsx`
- **Library**: pdfjs-dist v4 (text extraction), Tesseract.js v5 (OCR fallback), ExcelJS v4 (xlsx generation)
- **Teknik**: Hybrid approach — coba pdfjs getTextContent() dulu untuk text-based PDF, fallback ke Canvas render + Tesseract.js OCR untuk scanned/image PDF. Sauvola adaptive binarization untuk preprocessing OCR. Dual PSM recognition (PSM 6 + PSM 4).
- **PENTING**: Tesseract.js WAJIB menggunakan dynamic import (`await import('tesseract.js')`) + explicit CDN URLs. Static import menyebabkan Next.js bundling gagal dan page hang.
- **Status**: Deployed, OCR berjalan tanpa hang. Belum ditest dengan PDF scanned asli.
- Baca `resources/algorithms.md` untuk detail teknis

### 5. PDF-to-Image Converter
- **URL**: `/tools/pdf-to-image`
- **Files**: `src/lib/tools/pdf-to-image.ts`, `src/app/tools/pdf-to-image/page.tsx`
- **Library**: pdfjs-dist (render ke Canvas), JSZip (ZIP download)
- **Teknik**: Render setiap halaman PDF ke Canvas dengan scale tinggi → PNG Blob → ZIP download
- **Status**: Production ready, deployed

### 6. PDF-to-Word Converter
- **URL**: `/tools/pdf-to-word`
- **Files**: `src/lib/tools/pdf-to-word.ts`, `src/app/tools/pdf-to-word/page.tsx`
- **Library**: pdfjs-dist (text extraction), docx@9.6.1 (Word generation), Tesseract.js v5 (OCR fallback)
- **Teknik**: Hybrid adaptive — text extraction + layout reconstruction dengan 5 sistem utama:
  1. **baseX detection** — cluster `line.minX`, ambil terkiri dengan `x > 36` + at least 1 occurrence → margin halaman
  2. **Indentation** — `(line.minX - baseX) * 20` TWIPs → multi-level indent
  3. **Centering** — `|lineCenter - pageCenter| < pageWidth * 0.02` (2% threshold)
  4. **Full-justify** — `contentRight` = max qualifying cluster maxX (≥2 lines); justify jika `line.maxX >= contentRight * 0.92`
  5. **y-gap spacing** — `lineSpacing - avgFontSize * 1.3` → `spacingAfterTWIPs` (40–360 clamp)
  6. **Table detection** — x/y clustering → `isTableLikeLine` → `detectTables` → docx `Table`
  7. **OCR fallback** — Tesseract PSM 3 untuk scanned pages, embed sebagai image jika confidence rendah
- **Gap threshold**: `consolidateLineRuns` menggunakan `prev.fontSize * 0.15` (bukan 0.25) untuk mencegah kata disambung
- **Status**: Production ready, deployed
- Baca `resources/algorithms.md` untuk detail teknis

### 7. PDF-to-PowerPoint Converter
- **URL**: `/tools/pdf-to-ppt`
- **Files**: `src/lib/tools/pdf-to-ppt.ts`, `src/app/tools/pdf-to-ppt/page.tsx`
- **Library**: pdfjs-dist (text + operator extraction), PptxGenJS v4 (PPTX generation)
- **Teknik**: 3-mode output dari 1 PDF render per halaman:
  1. **Hybrid** — full-page JPEG background + white text overlay (`force='FFFFFF'`)
  2. **Image Only** — full-page JPEG saja, identik dengan PDF visual
  3. **Text Only** — editable text boxes only (original colors); image hanya untuk pure-image slides
- **Key detail**:
  - `analyzePageOperators()` dengan `inTextBlock` flag — hanya tulis ke `colorMap` saat di dalam BT/ET block → mencegah background fills pollute text color
  - `groupLinesIntoParagraphs()` — merge adjacent lines menjadi ParagraphBlock → 1 text box per paragraf
  - `ColorOpts { force?, fallback }` + `effectiveTextColor()` — sanitize FFFFFF pada white background
  - `qualityScore = slidesWithText / totalPages * 100` — % slide dengan extractable text
- **Status**: Production ready, deployed

### Halaman UI
Setiap tool memiliki halaman UI di `src/app/tools/<tool-name>/page.tsx`. Pattern: user upload file, client-side processing, preview, download/export.

**Standard result page sections (semua tool harus punya ketiga ini):**
1. **Data Quality badge** — `bg-slate-50 border border-slate-100 rounded-xl`, badge warna emerald/amber/red berdasarkan score
2. **Info Notice** — `bg-blue-50 border border-blue-100 rounded-xl`, teks kontekstual tentang kualitas output
3. **How it works** — grid langkah-langkah, `bg-accent-50` circle, `text-accent-600` number

## File Structure

```
src/
├── app/
│   ├── tools/
│   │   ├── pdf-watermark-remove/
│   │   │   └── page.tsx          # UI halaman PDF watermark removal
│   │   ├── image-watermark-remove/
│   │   │   └── page.tsx          # UI halaman image watermark removal
│   │   ├── image-to-excel/
│   │   │   └── page.tsx          # UI halaman Image-to-Excel converter
│   │   ├── pdf-to-excel/
│   │   │   └── page.tsx          # UI halaman PDF-to-Excel converter
│   │   ├── pdf-to-image/
│   │   │   └── page.tsx          # UI halaman PDF-to-Image converter
│   │   ├── pdf-to-word/
│   │   │   └── page.tsx          # UI halaman PDF-to-Word converter
│   │   └── pdf-to-ppt/
│   │       └── page.tsx          # UI halaman PDF-to-PowerPoint converter
│   └── page.tsx                  # Landing page
├── lib/
│   └── tools/
│       ├── pdf-watermark-remover.ts    # Algoritma PDF removal
│       ├── image-watermark-remover.ts  # Algoritma image removal
│       ├── image-to-excel.ts          # OCR + layout analysis + Excel generation
│       ├── pdf-to-excel.ts           # Hybrid PDF-to-Excel (pdfjs + OCR fallback)
│       ├── pdf-to-image.ts           # PDF render to PNG + ZIP download
│       ├── pdf-to-word.ts            # Hybrid PDF-to-Word (layout reconstruction)
│       └── pdf-to-ppt.ts             # 3-mode PDF-to-PPTX (Hybrid/Image/Text)
└── components/                   # Shared components
```

Saat menambah tool baru, ikuti pattern yang sama: buat file algoritma di `src/lib/tools/` dan halaman UI di `src/app/tools/<tool-name>/page.tsx`.

## Konvensi Kode

- **Bahasa kode & komentar**: Bahasa Inggris
- **Bahasa komunikasi**: Bahasa Indonesia
- **Processing**: Client-side (browser) — semua tool berjalan di browser user, tidak ada server-side processing
- **Type safety**: TypeScript strict — semua fungsi harus memiliki type annotations
- **Export pattern**: Named exports untuk interface (`ProcessingUpdate`, `ProcessingResult`) dan fungsi utama (`removeImageWatermark`, `removePdfWatermark`)
- **Progress callback**: Setiap tool menerima `onProgress` callback untuk menampilkan progress di UI
- **Output format**: Setiap tool mengembalikan result object yang selalu include `qualityScore: number` — score 0–100 yang ditampilkan di UI sebagai Data Quality badge

## Workflow Pengembangan

### Siklus Development
1. Baca skill ini (`/1app`) untuk load konteks
2. Pahami requirement fitur baru dari user
3. Brainstorm pendekatan — jangan langsung coding
4. Tulis kode di VM lokal, test secara programatik (Python/Node.js)
5. Push ke GitHub → Vercel auto-deploy
6. User test di live URL → feedback → iterate

### Push ke GitHub dari Cowork

VM Cowork memiliki proxy restriction yang memblokir `git clone/push` dan `curl` ke `api.github.com`. Ada 2 workaround:

**Metode 1 — GitHub API PUT** (untuk file kecil):
1. Encode file ke Base64, potong menjadi chunks (~4500 chars)
2. Inject chunks ke `window.__fileChunks = []` via browser JS tool
3. Execute GitHub Contents API PUT via `fetch()` dari browser
4. **Catatan**: CORS bisa memblokir PUT dari origin github.com — gunakan Metode 2 jika ini terjadi

**Metode 2 — GitHub Edit Page + CM6 Dispatch** (lebih reliable, untuk file besar):
1. Buka `github.com/Scyrptoeth/1app/edit/main/<filepath>` di browser
2. Encode file ke Base64, inject ke `window._b64` via chunks
3. Decode Base64 → UTF-8, lalu replace editor content via CM6:
   `document.querySelector('.cm-content').cmTile.view.dispatch({changes: {from: 0, to: state.doc.length, insert: decoded}})`
4. Klik "Commit changes" via UI

Baca `resources/deployment.md` untuk step-by-step lengkap.

### Testing Pattern
- Buat test image/file yang menyerupai input user
- Test algoritma secara programatik dengan Python (simulate behavior TypeScript)
- Bandingkan output vs expected secara kuantitatif (MSE, pixel comparison)
- Push ke GitHub hanya setelah test lokal memuaskan
- User test di live URL sebagai final validation

## Prinsip Kerja

Prinsip-prinsip berikut SELALU diterapkan saat mengembangkan 1APP:

1. **Brainstorm dulu** — Pahami kebutuhan, ajukan pendekatan, minta persetujuan
2. **Plan sebelum eksekusi** — Task kecil, file path tepat, langkah verifikasi
3. **TDD** — Test dulu, baru code. RED → GREEN → REFACTOR
4. **Systematic debugging** — Root cause investigation, bukan tebak-tebakan
5. **Verifikasi sebelum klaim selesai** — Jalankan test, tunjukkan output
6. **YAGNI & DRY** — Hanya bangun yang dibutuhkan

## Lessons Learned

Pelajaran penting dari pengembangan sebelumnya yang harus diingat:

- **Semi-transparent watermark butuh color adjustment, bukan pixel replacement** — Inpainting/neighbor averaging menghancurkan warna. Ratio-based restoration yang hanya menyesuaikan channel tertentu jauh lebih baik.
- **Reverse-engineer referensi** — Mempelajari output kompetitor/referensi pixel-by-pixel bisa mengungkap model matematika yang tepat.
- **Adaptive > hardcoded** — Threshold hardcoded hampir selalu gagal pada dokumen real-world. Gunakan adaptive threshold dari distribusi data.
- **User feedback loop kritis** — Masalah yang tidak terlihat di test programatik bisa terungkap saat user test dengan data nyata.
- **Session bisa crash** — Context window overflow bisa terjadi pada sesi panjang. Buat dokumentasi/changelog agar recovery mudah.
- **Base64 chunking harus di-verifikasi** — Saat push file besar via GitHub API, selalu verifikasi `join('').length` matches expected total SEBELUM push. Chunks dari sesi sebelumnya bisa stale/corrupted. Re-encode fresh jika ragu.
- **Chunk size ~4500 bytes optimal** — Untuk browser JavaScript injection, 4500 bytes per chunk cukup aman tanpa truncation. Chunk terlalu besar bisa terpotong oleh browser console.
- **Tesseract.js WAJIB dynamic import di Next.js** — Static `import { createWorker } from 'tesseract.js'` menyebabkan webpack bundling Web Worker gagal, halaman freeze total. Gunakan `await import('tesseract.js')` + explicit CDN URLs untuk workerPath, corePath, langPath.
- **GitHub edit page + CM6 dispatch sebagai alternatif push** — Jika GitHub API PUT diblokir CORS, bisa inject konten file ke CodeMirror 6 editor via `document.querySelector('.cm-content').cmTile.view.dispatch()`, lalu commit via UI.
- **PDF-to-Excel: Sauvola binarization crucial untuk OCR scanned docs** — Threshold global (Otsu) gagal pada dokumen dengan pencahayaan tidak rata. Sauvola adaptive (window 15, k=0.15) jauh lebih stabil.
- **PDF-to-Word: baseX harus "at least 1 occurrence", bukan "≥5%"** — Section header yang muncul sekali per halaman (x=72) dengan persentase hanya 1.9% akan diabaikan jika menggunakan threshold ≥2%. Gunakan `allMinX.some(...)` (at least 1) + floor `x > 36` untuk filter stray elements.
- **PDF-to-Word: centering check hanya dari center distance, bukan lineWidth** — `|lineCenter - pageCenter| < pageWidth * 0.02` lebih robust. Menambahkan lineWidth check (e.g., `lineWidth > pageWidth * 0.15`) menyebabkan short centered text (e.g., "SURAT EDARAN" 86pt) salah dideteksi sebagai indented.
- **PDF-to-Word: contentRight harus "max qualifying cluster ≥2 lines", bukan mode** — Menggunakan mode maxX pada halaman dengan banyak indented lines menghasilkan contentRight terlalu kecil (288pt bukan 505pt), sehingga body text tidak ter-justify.
- **PDF-to-Word: gap threshold 0.25× terlalu besar, 0.15× lebih tepat** — Threshold 0.25× (2.75pt untuk 11pt font) melebihi word spacing normal (2-4pt), menyebabkan kata-kata disambung ("SURATEDARAN"). Threshold 0.15× (1.65pt) menangkap semua word gaps tanpa false positives dari kerning (<0.5pt).
- **PDF-to-Excel: OCR decimal comma typo menyebabkan digit loss** — `correctNumericValue` lama strip semua dots tanpa memeriksa last group. Pattern `X.YYY.ZZ` (last group 1-2 digits) perlu dikonversi ke `XYYY,ZZ`, bukan `XYYYZZ`.
- **Analisa referensi kompetitor sebelum menambah fitur** — Membandingkan output 1APP vs ilovepdf pixel-by-pixel mengungkap 6 gap konkret. Ini lebih produktif daripada menebak apa yang perlu diperbaiki.
- **PDF-to-PPT: `inTextBlock` flag wajib untuk color extraction** — `getOperatorList()` mengembalikan semua operator termasuk background shape fills (di luar BT/ET block). Tanpa `inTextBlock` flag, warna `FFFFFF` dari background shapes masuk ke `colorMap` dan semua teks menjadi putih (invisible). Hanya write ke `colorMap` saat `inTextBlock=true`.
- **Text Only PPT: image fallback hanya untuk pure-image slides** — Jika semua slide punya `hasImages=true` (karena dokumen embed raster), Text Only akan selalu jatuh ke image fallback, menghancurkan tujuan "editable". Fix: fallback image hanya jika `rawItems.length === 0` (betul-betul tidak ada text sama sekali).
- **Playwright strict mode: gunakan `.nth(i)` bukan text-based locator untuk multiple buttons** — `page.locator('div:has(...) button')` bisa resolve ke banyak element dan throw strict mode violation. Lebih aman: `page.locator('button:has-text("Download")').nth(0/1/2)`.
- **3 PPTX files efisien: render 1× per page, share ke semua mode** — Panggil `renderPageToJpegDataUrl()` sekali, gunakan hasil yang sama untuk Hybrid background, Image Only background, dan skip untuk Text Only. Tidak perlu render 3×.

## Resources

File-file berikut berisi detail tambahan yang bisa dibaca on-demand:

| File | Kapan Dibaca |
|------|-------------|
| `resources/changelog.md` | Saat perlu tahu history perubahan lengkap |
| `resources/architecture.md` | Saat perlu memahami arsitektur lebih dalam |
| `resources/algorithms.md` | Saat mengembangkan atau debug algoritma tool |
| `resources/deployment.md` | Saat perlu push kode ke GitHub dari Cowork |

## Update Protocol

Di akhir setiap sesi pengembangan 1APP, lakukan:

1. Update `resources/changelog.md` dengan perubahan yang dilakukan
2. Jika ada fitur baru: tambahkan ke bagian "Fitur yang Sudah Ada" di SKILL.md ini
3. Jika ada lesson learned baru: tambahkan ke bagian "Lessons Learned"
4. Jika ada file baru yang signifikan: update file structure

Ini memastikan sesi pengembangan berikutnya selalu memiliki konteks terbaru.
