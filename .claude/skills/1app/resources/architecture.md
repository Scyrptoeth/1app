# 1APP — Architecture Reference

> Detail arsitektur proyek. Baca saat perlu memahami struktur lebih dalam.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router, TypeScript strict) |
| Styling | Tailwind CSS |
| Deploy | Vercel (auto-deploy dari GitHub main) |
| PDF manipulation | pdf-lib (client-side) |
| PDF text extraction | pdfjs-dist v4 |
| OCR | Tesseract.js v5 (ind+eng) |
| Excel generation | ExcelJS v4 |
| Image processing | Canvas API (native browser) |

## Architecture Principle: 100% Client-Side

Seluruh processing terjadi di browser user. Tidak ada server API, tidak ada data yang dikirim ke server. Ini memberikan:
- **Privasi total** — file user tidak pernah meninggalkan browser
- **Zero server cost** — Vercel hanya serve static files
- **Offline capable** (setelah initial load)
- **No scalability concerns** — setiap user memproses di device mereka sendiri

## File Structure

```
1app/
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Landing page
│   │   ├── layout.tsx                        # Root layout
│   │   └── tools/
│   │       ├── pdf-watermark-remove/
│   │       │   └── page.tsx                  # PDF watermark removal UI
│   │       ├── image-watermark-remove/
│   │       │   └── page.tsx                  # Image watermark removal UI
│   │       ├── image-to-excel/
│   │       │   └── page.tsx                  # Image-to-Excel UI
│   │       └── pdf-to-excel/
│   │           └── page.tsx                  # PDF-to-Excel UI
│   ├── lib/
│   │   └── tools/
│   │       ├── pdf-watermark-remover.ts      # PDF removal algorithm
│   │       ├── image-watermark-remover.ts    # Image removal algorithm
│   │       ├── image-to-excel.ts             # OCR + column detection + Excel
│   │       └── pdf-to-excel.ts              # Hybrid PDF extraction + Excel
│   └── components/                           # Shared UI components
├── public/                                   # Static assets
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
├── CLAUDE.md                                 # Project instructions for Claude
├── HANDOFF.md                                # Migration state from Cowork
├── design.md                                 # Feature design decisions
├── plan.md                                   # Active task plan
├── progress.md                               # Progress tracker
└── .claude/
    ├── skills/
    │   ├── 1app/
    │   │   ├── SKILL.md                      # Full project context
    │   │   └── resources/
    │   │       ├── algorithms.md             # Algorithm details
    │   │       ├── architecture.md           # This file
    │   │       ├── changelog.md              # Change history
    │   │       └── deployment.md             # Deployment guide
    │   └── update1app/
    │       └── SKILL.md                      # End-of-session update workflow
    ├── shared-skills -> ~/.claude-personas/vibe-coder/skills  # Symlink
    └── settings.json                         # Hooks config
```

## Data Flow Pattern (All Tools)

```
User uploads file (browser)
    ↓
File read into ArrayBuffer / Canvas (browser memory)
    ↓
Algorithm processes data (CPU-bound, main thread or Web Worker)
    ↓
onProgress callback updates UI (progress bar, status text)
    ↓
Result: { blob, previewUrl, originalSize, processedSize }
    ↓
Preview displayed in UI
    ↓
User downloads result (browser download)
```

## Interface Contracts

```typescript
// Progress callback — used by all tools
type OnProgress = (update: ProcessingUpdate) => void;

interface ProcessingUpdate {
  stage: string;       // e.g., "Analyzing PDF...", "Running OCR..."
  progress: number;    // 0-100
}

// Result — returned by all tools
interface ProcessingResult {
  blob: Blob;          // Processed file
  previewUrl: string;  // Object URL for preview
  originalSize: number;
  processedSize: number;
}
```

## Adding New Tools

Pattern untuk menambah tool baru:
1. Buat file algoritma: `src/lib/tools/<tool-name>.ts`
2. Buat halaman UI: `src/app/tools/<tool-name>/page.tsx`
3. Implement `ProcessingResult` interface
4. Tambahkan `onProgress` callback support
5. Tambahkan link di landing page (`src/app/page.tsx`)
6. Update SKILL.md section "Fitur yang Sudah Ada"

## Deployment

Vercel auto-deploy: push ke `main` branch → Vercel builds → live at 1app-orcin.vercel.app.
Tidak ada konfigurasi khusus. Default Next.js build.
