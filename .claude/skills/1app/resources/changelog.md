# 1APP — Changelog

> History perubahan lengkap. Entry terbaru di atas.

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
