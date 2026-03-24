# 1APP — Changelog

> History perubahan lengkap. Entry terbaru di atas.

## 24 Maret 2026 (Sesi CLI — Image-to-Excel Framework Refactor)

### image-to-excel.ts — Framework Refactor (mirror pdf-to-excel)
- **Commits**: `d53bf7a`, `ed43248`
- **Files**: `src/lib/tools/image-to-excel.ts`
- **Perubahan**:
  - Fix critical bug: static Tesseract.js import → dynamic import dengan explicit CDN URLs
  - Hapus 30+ LABEL_CORRECTIONS ad-hoc, ganti dengan `ID_FINANCIAL_VOCAB` (100+ terms) + `levenshtein()` + `correctOcrWord()` + `correctLabel()` 5-step pipeline
  - Add parenthesized negative support `(1.234.567) → -1234567` di `parseIndonesianNumber()`
  - Add `user_defined_dpi` ke OCR parameters
  - Add bias-aware column assignment untuk short numeric tokens
  - Fix 3-column bilingual detection: outlier edge filter, dynamic value boundaries, threshold 35%→25%
- **Hasil**: 3 kolom nilai berhasil diekstrak dari dokumen bilingual (GoTo annual report)

### image-to-excel.ts — Description Column & Header Detection
- **Commits**: `7e64d6e`
- **Files**: `src/lib/tools/image-to-excel.ts`
- **Perubahan**:
  - Add `detectTableHeaderRow()` — deteksi row "Uraian | 2024 | 2023 | 2022 | Description" via anchor keyword "Uraian"
  - Inferensi tahun yang hilang (OCR gagal baca kotak berwarna): jika "2022" di kolom ke-3, inferensikan 2023 dan 2024
  - Filter preamble rows via `tableHeaderMinY` — hilangkan Key Financial Highlights, section descriptions
  - Kolom Description (teks English sisi kanan gambar) diekstrak sebagai kolom ke-5
  - Capture nilai "-" (dash) di area nilai sebagai penanda sel kosong
  - Ubah struktur header: hapus "No/Keterangan/Sub Jumlah", ganti dengan nama kolom dari OCR
  - Update `generateExcel()`: layout 5 kolom (Uraian | tahun | tahun | tahun | Description)
- **Hasil**: Ekstraksi 5 kolom lengkap, preamble bersih, header otomatis dari dokumen

### image-to-excel/page.tsx — Preview & How it works
- **Commit**: `5f3d924`
- **Files**: `src/app/tools/image-to-excel/page.tsx`
- **Perubahan**:
  - Migrasi ke shared components: ToolPageLayout + FileUploader + ProcessingView
  - Add stage "preview": tabel interaktif dengan kolom Uraian | tahun | Description
  - Add "Image Data Quality" confidence badge (hijau/amber/merah)
  - Add "How it works" 4-step section
  - Flow baru: upload → processing → preview → download (align dengan pdf-to-excel)
- **Hasil**: UI konsisten dengan pdf-to-excel

### UI — Data Quality Badge (kedua halaman)
- **Commits**: `006cec9`, `060c9fc`
- **Files**: `src/app/tools/image-to-excel/page.tsx`, `src/app/tools/pdf-to-excel/page.tsx`
- **Perubahan**:
  - Rename "OCR Confidence" → "Image Data Quality" di image-to-excel
  - Add "PDF Data Quality" badge di pdf-to-excel (matching design)
  - Add keterangan: "Extraction accuracy depends on Data Quality..."
  - Fix crash: `result.confidence.toFixed()` error untuk text-based PDF (`PdfToExcelResult` tidak punya field `confidence`). Guard dengan runtime check; text PDF tampilkan "Excellent (Text-based)"
- **Hasil**: Konsisten di kedua halaman, tidak crash untuk PDF berbasis teks

---

## 24 Maret 2026

### PDF-to-Excel Text-Path Improvements — Column Detection & Number Conversion

- **Commit**: `b6164ab` → `e81f9c9` → `f0380a8` → `7d131cc` → `0dffa61`
- **Files**: `src/lib/tools/pdf-to-excel.ts`, `src/app/tools/pdf-to-excel/page.tsx`
- **Perubahan**:
  - Tambah text-based PDF extraction path yang proper dengan columnar table support
  - 4 teknik column detection baru: font-height adaptive row grouping, dual-edge boundary (midpoint gap fisik untuk gap 5-60px), wide-gap fallback (>60px pakai x-midpoint), persistent gap detection (whitespace harus ada di ≥60% rows)
  - Number conversion untuk laporan keuangan: parenthesized negatives `(5.222.504)` → `-5222504`
  - Split merged "number+text" cells: `"66.086 Remeasurement..."` → number ke kolom value, text ke kolom description
  - Fix comma ambiguous: jika semua grup setelah koma persis 3 digit → thousands separator (`"10,114"` → `10114`), grup 1-2 digit tetap string (ambigu)
  - Fix merged number+text saat kolom berikutnya sudah ada string: prepend text fragment, jangan discard
- **Hasil**: Path A (text-based PDF) jauh lebih akurat untuk laporan keuangan Indonesia dengan angka multi-kolom

---

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
