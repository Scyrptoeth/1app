# 1APP — Changelog

> History perubahan lengkap. Entry terbaru di atas.

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
