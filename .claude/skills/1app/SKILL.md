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
- **Path A improvements (24 Mar 2026)**: Font-height adaptive row grouping, dual-edge/wide-gap column boundary, persistent gap detection, parenthesized negatives, comma ambiguous detection, merged cell splitting
- **Status**: Path A (text-based) production-quality untuk laporan keuangan Indonesia. Path B (OCR) belum ditest dengan PDF scanned asli.
- Baca `resources/algorithms.md` untuk detail teknis

### Halaman UI
Setiap tool memiliki halaman UI di `src/app/tools/<tool-name>/page.tsx`. Pattern: user upload file, client-side processing, preview, download/export.

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
│   │   └── pdf-to-excel/
│   │       └── page.tsx          # UI halaman PDF-to-Excel converter
│   └── page.tsx                  # Landing page
├── lib/
│   └── tools/
│       ├── pdf-watermark-remover.ts    # Algoritma PDF removal
│       ├── image-watermark-remover.ts  # Algoritma image removal
│       ├── image-to-excel.ts          # OCR + layout analysis + Excel generation
│       └── pdf-to-excel.ts           # Hybrid PDF-to-Excel (pdfjs + OCR fallback)
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
- **Output format**: Setiap tool mengembalikan `{ blob, previewUrl, originalSize, processedSize }`

## Workflow Pengembangan

### Siklus Development (CLI)
1. Baca skill ini untuk load konteks
2. Pahami requirement fitur baru dari user
3. Brainstorm pendekatan — jangan langsung coding (superpowers skill)
4. Tulis kode, test secara lokal (npm run test / npm run build)
5. Commit per task, push ke GitHub → Vercel auto-deploy
6. User test di live URL → feedback → iterate

### Push ke GitHub (CLI — Direct Git)

Di Claude Code CLI, git push berjalan langsung tanpa workaround:

```bash
git add <files>
git commit -m "type(scope): description"
git push origin main
```

Vercel auto-deploy dari branch main. Push = deploy.

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
- **Session bisa crash** — Context window overflow bisa terjadi pada sesi panjang. Buat dokumentasi/changelog agar recovery mudah. Di CLI, gunakan /compact dan /clear untuk manage context.
- **Tesseract.js WAJIB dynamic import di Next.js** — Static `import { createWorker } from 'tesseract.js'` menyebabkan webpack bundling Web Worker gagal, halaman freeze total. Gunakan `await import('tesseract.js')` + explicit CDN URLs untuk workerPath, corePath, langPath.
- **PDF-to-Excel: Sauvola binarization crucial untuk OCR scanned docs** — Threshold global (Otsu) gagal pada dokumen dengan pencahayaan tidak rata. Sauvola adaptive (window 15, k=0.15) jauh lebih stabil.
- **Comma ambiguity: 3-digit groups = thousands separator** — `"10,114"` unambiguously thousands karena semua post-comma groups persis 3 digit. `"1,5"` tetap string karena bisa desimal. Rule ini tidak perlu heuristic tambahan.
- **Dual-edge vs x-midpoint column boundary** — Untuk kolom rapat (5-60px gap), midpoint fisik antara right-edge kiri dan left-edge kanan lebih akurat dari x-midpoint. Untuk gap lebar (>60px), x-midpoint lebih aman karena right-aligned content bisa mulai jauh dari header.
- **Persistent gap detection eliminates false column splits** — Label panjang seperti "Pendapatan bersih dari operasi" sering punya spasi internal yang mirip column boundary. Mensyaratkan whitespace di ≥60% rows sebelum declare boundary mengeliminasi false positives ini.

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
