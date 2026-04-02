# 1APP — Design Document

> Ringkasan desain setiap fitur di 1APP. Terakhir diupdate: 24 Maret 2026.

## Problem Statement

User membutuhkan tool gratis, cepat, dan privat untuk memproses dokumen (PDF dan gambar) — khususnya menghapus watermark dan mengkonversi gambar/PDF tabel ke Excel. Semua processing harus client-side agar data user tidak pernah meninggalkan browser.

## Desain Arsitektur

**Pendekatan:** Single-page tools, masing-masing independen, 100% client-side.

Setiap tool mengikuti pattern yang sama: user upload file di browser, algoritma memproses di browser (Canvas API / pdf-lib / Tesseract.js), user preview hasil, user download output. Tidak ada backend, tidak ada server API, tidak ada data yang dikirim ke mana pun.

**Struktur file:** Algoritma di `src/lib/tools/`, UI di `src/app/tools/<tool-name>/page.tsx`. Shared interface: `{ blob, previewUrl, originalSize, processedSize }` + `onProgress` callback.

## Desain Per Fitur

### 1. PDF Watermark Removal

**Pendekatan yang dipilih:** ExtGState opacity manipulation via pdf-lib.

Watermark di PDF biasanya menggunakan graphics state dengan opacity rendah (ExtGState). Algoritma mendeteksi semua ExtGState entries, mengidentifikasi yang memiliki opacity < 1.0, menetralisasi opacity ke 0.0, dan menghapus content stream yang mereferensikan watermark graphics state tersebut.

**Alternatif yang dipertimbangkan:** Content stream regex removal (terlalu fragile, format PDF bervariasi antar generator).

### 2. Image Watermark Removal

**Pendekatan yang dipilih:** Ratio-based R/B G/B color restoration via Canvas API.

Semi-transparent watermark mengubah rasio channel warna (R/B dan G/B) secara konsisten. Algoritma mendeteksi pixel yang mengalami disruption rasio, lalu membalikkan alpha blending pada channel R dan G saja, mempertahankan channel B sebagai anchor.

**Alternatif yang ditolak:** Pixel replacement / inpainting (menghancurkan warna asli), neighbor averaging (blur artifacts), frequency domain filtering (terlalu slow untuk browser).

### 3. Image-to-Excel Converter

**Pendekatan yang dipilih:** Tesseract.js OCR + x-coordinate clustering + ExcelJS export.

OCR membaca teks dari gambar, posisi setiap kata digunakan untuk mendeteksi kolom via x-coordinate clustering (mengelompokkan kata berdasarkan posisi horizontal), baris dikelompokkan berdasarkan posisi vertikal. Hasilnya ditampilkan di editable preview table, lalu di-export ke .xlsx.

**Keputusan kunci:** Dynamic import Tesseract.js (wajib di Next.js), dual language ind+eng, editable preview sebelum export.

### 4. PDF-to-Excel Converter

**Pendekatan yang dipilih:** Hybrid — pdfjs getTextContent() + OCR fallback.

Untuk text-based PDF, pdfjs-dist mengekstrak teks beserta posisi langsung (cepat, akurat). Untuk scanned/image PDF, fallback ke Canvas rendering + Sauvola binarization + Tesseract.js OCR + Dual PSM (PSM 6 tabel + PSM 4 general).

**Keputusan kunci:** Sauvola adaptive (window 15, k=0.15) dipilih karena Otsu global threshold gagal pada dokumen dengan pencahayaan tidak rata.

### 5. X-Content-to-PDF & X-Content-to-Word

**Pendekatan yang dipilih:** Migrasi dari x-content-extractor ke 1APP.

Dua tool baru yang mengekstrak konten X (Twitter) — posts, threads, dan articles — menjadi dokumen PDF atau Word. Berbeda dari tool existing yang 100% client-side, tool ini menggunakan **server-side API routes** untuk fetch konten dari FXTwitter API (primary) + Syndication API (fallback).

**Flow:** User input URL → server fetch tweet data → client preview → client-side PDF/DOCX generation → download.

**Adaptasi dari source:**
- Styling: X dark theme (xd-*) → 1APP light theme (slate + accent blue)
- docx v8→v9: Tambah property `type` di setiap `ImageRun` constructor
- jsPDF v2→v4: Tidak ada perubahan (backward-compatible)
- file-saver → native download (URL.createObjectURL + anchor)
- Kategori baru: "extract" — karena behavior berbeda dari conversion (URL input vs file upload)
- API routes namespace: `/api/x-content/` (isolated)

**Keputusan kunci:**
- ToolPageLayout: tambah optional `privacyMessage` prop (default tetap "client-side", override untuk x-content tools)
- Dua halaman terpisah: PDF-only dan Word-only, masing-masing hanya tampilkan tombol export yang relevan
- Shared components di `src/components/x-content/` (TweetInput, TweetPreview, ExportButtons)

## Out of Scope (Saat Ini)

- User accounts / authentication
- Cloud storage
- Multi-page batch processing (beyond current single-file upload)
- Mobile-specific optimizations
