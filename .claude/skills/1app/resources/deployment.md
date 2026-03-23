# 1APP — Deployment Reference

> Panduan deployment. Di CLI, proses ini jauh lebih sederhana dari Cowork.

## CLI Deployment (Standard)

```bash
# 1. Pastikan build clean
npm run build

# 2. Commit perubahan
git add <files>
git commit -m "type(scope): description"

# 3. Push ke GitHub → Vercel auto-deploy
git push origin main
```

Vercel auto-deploy dari branch `main`. Setiap push = deploy.

**Preview deploy:** Push ke branch selain main (e.g., `feat/new-tool`) → Vercel membuat preview URL.

## Vercel Configuration

- **Build command**: `npm run build` (default Next.js)
- **Output directory**: `.next` (default)
- **Node.js version**: Default (managed by Vercel)
- **Environment variables**: Tidak ada — semua client-side
- **Domain**: `1app-orcin.vercel.app`

## Git Workflow

```bash
# Feature development
git checkout main && git pull origin main
git checkout -b feat/feature-name

# ... develop, test, commit per task ...

git push origin feat/feature-name
# → Vercel preview deploy → test di preview URL

# Merge ke production
git checkout main
git merge feat/feature-name
git push origin main
# → Vercel production deploy
```

## Troubleshooting

### Build Fails on Vercel
1. Run `npm run build` locally first
2. Check Vercel build logs di dashboard
3. Common issues: TypeScript errors, missing dependencies, import path errors

### Tesseract.js Build Issues
- WAJIB dynamic import: `await import('tesseract.js')`
- Static import akan menyebabkan webpack bundling failure
- CDN URLs harus explicit (workerPath, corePath, langPath)

### Page Loads but Tool Doesn't Work
- Check browser console for errors
- Verify library versions match (pdfjs-dist v4, tesseract.js v5, exceljs v4)
- Test di incognito mode (clear cache)

## Legacy: Cowork Deployment (DEPRECATED)

> Metode di bawah ini TIDAK diperlukan lagi di CLI. Didokumentasikan untuk referensi historis saja.

Di Cowork, `git push` tidak bisa jalan langsung karena proxy restriction. Dua workaround yang digunakan:

1. **GitHub API PUT via browser** — Encode file ke Base64, inject chunks ke browser, execute GitHub Contents API PUT via fetch()
2. **GitHub Edit Page + CM6 dispatch** — Buka file edit page, inject content ke CodeMirror 6 editor via dispatch(), commit via UI

Kedua metode ini rentan error (Base64 chunk corruption, CORS blocking, CM6 state mismatch). Di CLI, cukup `git push`.
