// ============================================================================
// Word to PDF Converter — Hybrid Approach
//
// Pipeline:
//   1. docx-preview  → render DOCX into paginated hidden DOM
//      Handles: fonts, bold/italic/underline/strike, images (with srcRect
//      crop via CSS clip-path), tables, charts, headers/footers, lists.
//   2. html2canvas   → capture each page as high-res image (visual layer)
//      onclone fixes: clip-path:rect() → inset() for correct image cropping
//   3. jsPDF         → embed image + invisible text overlay for search/copy
//
// Key lessons:
//   - Dynamic imports prevent Next.js webpack bundling issues
//   - Hyphens/word-break CSS must be disabled before capture (prevents
//     mid-word text splitting in justify-aligned text)
//   - clip-path:rect() (CSS4) is not supported by html2canvas 1.x;
//     must be converted to clip-path:inset() in onclone callback
// ============================================================================

// ---------------------------------------------------------------------------
// Lazy loaders — each library loaded at most once per session
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _renderAsync: any = null;
async function getDocxPreview() {
  if (_renderAsync) return _renderAsync;
  const mod = await import("docx-preview");
  _renderAsync = mod.renderAsync;
  return _renderAsync;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _html2canvas: any = null;
async function getHtml2Canvas() {
  if (_html2canvas) return _html2canvas;
  const mod = await import("html2canvas");
  _html2canvas = mod.default;
  return _html2canvas;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _JsPDF: any = null;
async function getJsPDF() {
  if (_JsPDF) return _JsPDF;
  const mod = await import("jspdf");
  // jsPDF v4 uses default export
  _JsPDF = mod.default;
  return _JsPDF;
}

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface ProcessingUpdate {
  progress: number;
  status: string;
  currentPage?: number;
  totalPages?: number;
}

export interface WordToPdfResult {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  qualityScore: number;
  pageCount: number;
}

// Internal: text node extracted from the rendered DOM for invisible text layer
interface ExtractedTextNode {
  text: string;
  x: number;       // px from page element left
  y: number;       // px from page element top
  fontSize: number; // px
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function convertWordToPdf(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<WordToPdfResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (!ext || !["docx", "doc"].includes(ext)) {
    throw new Error("Unsupported file format. Please upload a .docx or .doc file.");
  }

  if (ext === "doc") {
    throw new Error(
      "DOC_FORMAT_NOT_SUPPORTED: The legacy .doc format cannot be reliably " +
      "converted in the browser. Please convert to .docx first using Microsoft " +
      "Word or LibreOffice (File → Save As → .docx), then try again."
    );
  }

  try {
    onProgress({ progress: 5, status: "Reading Word document..." });

    onProgress({ progress: 15, status: "Loading conversion libraries..." });
    const [renderAsync, html2canvas, JsPDF] = await Promise.all([
      getDocxPreview(),
      getHtml2Canvas(),
      getJsPDF(),
    ]);

    onProgress({ progress: 25, status: "Rendering document..." });

    // Off-screen container — position:fixed keeps it in the layout flow
    // without affecting scroll, but html2canvas can still measure and capture it.
    const container = document.createElement("div");
    container.setAttribute("data-docx-conv", "1");
    container.style.cssText = [
      "position:fixed",
      "top:0",
      "left:-99999px",
      "width:794px",
      "background:#fff",
      "z-index:-9999",
      "pointer-events:none",
      "overflow:visible",
    ].join(";");
    document.body.appendChild(container);

    // Inject CSS overrides for the container.
    // Critical: disabling hyphens prevents docx-preview from breaking words
    // at syllable boundaries under justify alignment, which causes text like
    // "mempertahankan" to appear as "memp ertahankan" in the captured image.
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      [data-docx-conv="1"] * {
        hyphens: none !important;
        -webkit-hyphens: none !important;
        -ms-hyphens: none !important;
        word-break: normal !important;
        overflow-wrap: break-word !important;
        word-wrap: break-word !important;
      }
    `;
    document.head.appendChild(styleEl);

    try {
      // renderAsync accepts Blob — pass File directly (extends Blob).
      // className "docx" → pages become <section class="docx">
      await renderAsync(file, container, null, {
        className: "docx",
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        ignoreLastRenderedPageBreak: false,
      });

      onProgress({ progress: 40, status: "Preparing pages..." });

      // Wait for all images to be fully decoded (base64 URLs decode async in some browsers)
      await waitForImages(container);

      // Pre-crop srcRect images via canvas so html2canvas sees plain uncropped images.
      // html2canvas 1.x does not support clip-path (neither rect() nor inset()), so
      // CSS-based clipping is invisible to it. Canvas pre-cropping solves this by
      // replacing the img src with the already-cropped pixels before html2canvas runs.
      const croppedCount = await applyImageCroppingViaCanvas(container);
      console.log(`[word-to-pdf] Canvas-cropped ${croppedCount} srcRect images`);

      // Fallback: any remaining rect() that canvas couldn't crop (naturalW=0) — convert
      // to inset() as a best-effort (html2canvas may still ignore it, but keeps the DOM clean)
      const fallbackCount = fixClipPathRect(container);
      if (fallbackCount > 0) {
        console.log(`[word-to-pdf] Fallback rect→inset on ${fallbackCount} images`);
      }

      const pageElements = collectPageElements(container);

      if (pageElements.length === 0) {
        throw new Error("The document has no content to convert.");
      }

      const totalPages = pageElements.length;
      onProgress({ progress: 45, status: `Found ${totalPages} pages`, totalPages });

      const firstPage = pageElements[0];
      const pageWidthPx = firstPage.offsetWidth || 794;
      const pageHeightPx = firstPage.offsetHeight || 1123;

      // A4 in PDF points
      const PDF_WIDTH_PT = 595.28;
      const PDF_HEIGHT_PT = 841.89;
      const scaleX = PDF_WIDTH_PT / pageWidthPx;
      const scaleY = PDF_HEIGHT_PT / pageHeightPx;

      const pdf = new JsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

      let imagesRendered = 0;
      let totalTextNodes = 0;

      for (let i = 0; i < pageElements.length; i++) {
        const pageEl = pageElements[i];
        const pageNum = i + 1;

        onProgress({
          progress: Math.round(45 + (i / totalPages) * 45),
          status: `Converting page ${pageNum} of ${totalPages}...`,
          currentPage: pageNum,
          totalPages,
        });

        if (i > 0) pdf.addPage("a4", "portrait");

        // --- Visual layer ---
        // Capture the page as a high-res raster image.
        // clip-path:rect() has already been converted to inset() above.
        const canvas = await html2canvas(pageEl, {
          scale: 1.5,         // 1.5× = ~108 DPI — good quality, smaller file
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#ffffff",
          logging: false,
          width: pageWidthPx,
          height: pageHeightPx,
          windowWidth: pageWidthPx,
          windowHeight: pageHeightPx,
          x: 0,
          y: 0,
        });

        const imgData = canvas.toDataURL("image/jpeg", 0.85);
        pdf.addImage(imgData, "JPEG", 0, 0, PDF_WIDTH_PT, PDF_HEIGHT_PT);
        imagesRendered++;

        // --- Invisible text layer ---
        // Overlay text extracted from the DOM at the correct positions using
        // renderingMode:"invisible". The text is in the PDF content stream
        // but not painted, making it searchable, selectable, and copy-able.
        const textNodes = extractTextNodes(pageEl);
        totalTextNodes += textNodes.length;

        if (textNodes.length > 0) {
          // Use a single font family throughout for consistency.
          // Helvetica is the closest standard PDF font to Segoe UI (sans-serif).
          pdf.setFont("helvetica", "normal");

          for (const node of textNodes) {
            if (!node.text.trim()) continue;

            const pdfX = node.x * scaleX;
            const pdfY = node.y * scaleY;
            const pdfFontSize = Math.max(4, node.fontSize * scaleY);

            pdf.setFontSize(pdfFontSize);

            try {
              pdf.text(node.text, pdfX, pdfY, {
                baseline: "top",
                renderingMode: "invisible",
              });
            } catch {
              // Skip text nodes that fail (special chars, zero-width, etc.)
            }
          }
        }
      }

      onProgress({ progress: 92, status: "Assembling PDF..." });

      const pdfBlob = pdf.output("blob");
      const previewUrl = URL.createObjectURL(pdfBlob);

      const qualityScore = computeQualityScore({ totalPages, imagesRendered, totalTextNodes });

      onProgress({ progress: 100, status: "Done!" });

      return {
        blob: pdfBlob,
        previewUrl,
        originalSize: file.size,
        processedSize: pdfBlob.size,
        qualityScore,
        pageCount: totalPages,
      };
    } finally {
      document.head.removeChild(styleEl);
      document.body.removeChild(container);
    }
  } catch (err) {
    console.error("[word-to-pdf] Conversion failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Wait for all <img> elements inside container to finish loading
// ---------------------------------------------------------------------------

function waitForImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => {
            img.removeEventListener("load", done);
            img.removeEventListener("error", done);
            resolve();
          };
          img.addEventListener("load", done);
          img.addEventListener("error", done);
          // Safety timeout — don't block forever on a broken image
          setTimeout(resolve, 5000);
        })
    )
  ).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Canvas-based image pre-cropping for srcRect images
//
// docx-preview applies clip-path:rect() to <img> elements for DOCX srcRect
// crops. html2canvas 1.x does not render clip-path at all, so images appear
// uncropped. This function replaces each clipped img's src with a canvas-
// cropped version (in natural pixel space) and removes the clip-path, so
// html2canvas just sees a plain pre-cropped image.
//
// Returns the number of images successfully cropped.
// ---------------------------------------------------------------------------

async function applyImageCroppingViaCanvas(container: HTMLElement): Promise<number> {
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
  let count = 0;

  for (const img of imgs) {
    const rawStyle = img.getAttribute("style") || "";
    const cpMatch = rawStyle.match(/clip-path\s*:\s*(rect\([^)]+\))/i);
    const cpInline =
      img.style.clipPath ||
      (img.style as CSSStyleDeclaration & Record<string, string>)["clip-path"] ||
      "";
    const cp =
      (cpInline.startsWith("rect(") ? cpInline : "") ||
      (cpMatch ? cpMatch[1] : "");

    if (!cp || !cp.startsWith("rect(")) continue;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (nw === 0 || nh === 0) continue; // no natural dimensions → skip (fallback handles it)

    const inner = cp.slice(5, -1).trim(); // strip "rect(" and ")"
    const parts = inner.split(/\s+/);
    if (parts.length < 4) continue;

    const topPct    = parseFloat(parts[0]);
    const rightPct  = parseFloat(parts[1]);
    const bottomPct = parseFloat(parts[2]);
    const leftPct   = parseFloat(parts[3]);

    if ([topPct, rightPct, bottomPct, leftPct].some(isNaN)) continue;

    // Convert percentages to natural-image pixel coordinates
    const cropTop    = (topPct    / 100) * nh;
    const cropRight  = (rightPct  / 100) * nw;
    const cropBottom = (bottomPct / 100) * nh;
    const cropLeft   = (leftPct   / 100) * nw;

    const cropW = cropRight  - cropLeft;
    const cropH = cropBottom - cropTop;

    if (cropW <= 0 || cropH <= 0) continue;

    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(cropW);
    canvas.height = Math.round(cropH);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    // Draw only the visible crop region from the original image
    ctx.drawImage(img, cropLeft, cropTop, cropW, cropH, 0, 0, canvas.width, canvas.height);

    // Replace src with the cropped version and clear clip-path
    img.src = canvas.toDataURL("image/png");
    img.style.clipPath = "";
    (img.style as CSSStyleDeclaration & Record<string, string>)["clip-path"] = "";
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Fix clip-path:rect() → clip-path:inset() for html2canvas compatibility
//
// docx-preview renders srcRect image crops as:
//   clip-path: rect(top% right% bottom% left%)   ← CSS Shapes Level 2
//
// html2canvas 1.x does not support rect() in clip-path. It DOES support
// inset(). Conversion formula:
//   clip-path: rect(t r b l) → clip-path: inset(t (100-r) (100-b) l)
//
// Example: rect(6.48% 100% 45.70% 0%) → inset(6.48% 0% 54.30% 0%)
//
// Applied to the actual rendered container DOM (not a clone) before any
// html2canvas capture, so the converted values are visible to the renderer.
//
// Returns the number of elements that were fixed.
// ---------------------------------------------------------------------------

function fixClipPathRect(root: HTMLElement): number {
  let count = 0;
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    // Try both camelCase and kebab-case accessors, plus raw style attribute
    // to handle cross-browser inline style serialization differences.
    const rawStyle = el.getAttribute("style") || "";
    const cpMatch = rawStyle.match(/clip-path\s*:\s*(rect\([^)]+\))/i);
    const cpInline = el.style.clipPath || (el.style as CSSStyleDeclaration & Record<string, string>)["clip-path"] || "";
    const cp = (cpInline.startsWith("rect(") ? cpInline : "") || (cpMatch ? cpMatch[1] : "");

    if (!cp || !cp.startsWith("rect(")) return;

    const inner = cp.slice(5, -1).trim(); // strip "rect(" and ")"
    const parts = inner.split(/\s+/);
    if (parts.length < 4) return;

    const top = parseFloat(parts[0]);
    const right = parseFloat(parts[1]);
    const bottom = parseFloat(parts[2]);
    const left = parseFloat(parts[3]);

    if (isNaN(top) || isNaN(right) || isNaN(bottom) || isNaN(left)) return;

    // Convert: inset clips inward from each edge
    const insetTop    = top;
    const insetRight  = 100 - right;
    const insetBottom = 100 - bottom;
    const insetLeft   = left;

    const insetValue = `inset(${insetTop.toFixed(2)}% ${insetRight.toFixed(2)}% ${insetBottom.toFixed(2)}% ${insetLeft.toFixed(2)}%)`;
    el.style.clipPath = insetValue;
    count++;
  });
  return count;
}

// ---------------------------------------------------------------------------
// Collect page elements from docx-preview rendered output
// ---------------------------------------------------------------------------

function collectPageElements(container: HTMLElement): HTMLElement[] {
  // docx-preview v0.3.x renders each Word page as <section class="docx">
  // when className option is "docx" and inWrapper is false.
  const selectors = ["section.docx", "article.docx", ".docx"];

  for (const sel of selectors) {
    const found = Array.from(container.querySelectorAll<HTMLElement>(sel));
    if (found.length > 0) {
      // Only top-level page wrappers — exclude nested .docx elements
      return found.filter(
        (el) => !found.some((other) => other !== el && other.contains(el))
      );
    }
  }

  // Fallback: treat the container itself as a single page
  return [container];
}

// ---------------------------------------------------------------------------
// Extract text nodes with DOM positions for the invisible text layer
// ---------------------------------------------------------------------------

function extractTextNodes(pageEl: HTMLElement): ExtractedTextNode[] {
  const nodes: ExtractedTextNode[] = [];
  const pageRect = pageEl.getBoundingClientRect();

  const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.trim();
      if (!text) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const content = textNode.textContent;
    if (!content?.trim()) continue;

    const parent = textNode.parentElement;
    if (!parent) continue;

    const range = document.createRange();
    range.selectNode(textNode);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) continue;

    const style = window.getComputedStyle(parent);
    const fontSize = parseFloat(style.fontSize) || 12;

    nodes.push({
      text: content,
      x: rect.left - pageRect.left,
      y: rect.top - pageRect.top,
      fontSize,
    });
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Quality score (0–100)
// ---------------------------------------------------------------------------

function computeQualityScore({
  totalPages,
  imagesRendered,
  totalTextNodes,
}: {
  totalPages: number;
  imagesRendered: number;
  totalTextNodes: number;
}): number {
  let score = 100;
  if (totalTextNodes === 0) score -= 30;
  if (totalPages === 0) score -= 50;
  if (imagesRendered < totalPages) {
    score -= Math.round(((totalPages - imagesRendered) / totalPages) * 40);
  }
  return Math.max(0, Math.min(100, score));
}
