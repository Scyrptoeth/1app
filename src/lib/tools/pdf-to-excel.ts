/**
 * PDF-to-Excel Converter
 *
 * Two-phase pipeline:
 *   Phase 1 Ã¢ÂÂ extractFromPdf(): PDF Ã¢ÂÂ render pages to canvas Ã¢ÂÂ OCR via Tesseract.js Ã¢ÂÂ structured data
 *   Phase 2 Ã¢ÂÂ generateExcel(): Structured data Ã¢ÂÂ .xlsx Blob via ExcelJS
 *
 * Supports:
 *   - Single-column layout (e.g., Profit & Loss / Laba Rugi)
 *   - Side-by-side layout  (e.g., Balance Sheet / Neraca)
 *   - Multi-page PDFs (each page Ã¢ÂÂ one worksheet)
 *   - Currency (Rp) number detection and formatting
 *   - Auto header / total / indent detection
 */

// ExcelJS is dynamically imported inside generateExcel() for browser compatibility

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ProcessingUpdate {
  progress: number; // 0-100
  status: string;
}

export interface RowData {
  label: string;
  subValue: number | null;
  mainValue: number | null;
  isHeader: boolean;
  isTotal: boolean;
  isIndented: boolean;
  isNumbered: boolean;
  rowNumber: string;
}

export interface PageData {
  pageNumber: number;
  sheetName: string;
  isSideBySide: boolean;
  // Single-column data
  rows?: RowData[];
  // Side-by-side data
  leftRows?: RowData[];
  rightRows?: RowData[];
  leftTitle?: string;
  rightTitle?: string;
}

export interface PdfExtractionResult {
  pages: PageData[];
  totalPages: number;
}

export interface PdfToExcelResult {
  blob: Blob;
  pages: PageData[];
  originalSize: number;
  processedSize: number;
}

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  conf: number;
}

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

function isNumericWord(text: string): boolean {
  const cleaned = text.replace(/[.,_=\s()\-]/g, "");
  const digitCount = cleaned.split('').filter((c) => c >= "0" && c <= "9").length;
  return digitCount >= 3;
}

function isLabelWord(text: string): boolean {
  if (text === "Rp" || text === "Rp.") return false;
  if (isNumericWord(text)) return false;
  if (text.length <= 1 && !/[a-zA-Z]/.test(text)) return false;
  return true;
}

function cleanNumber(text: string): number | null {
  let s = text.replace(/^[\s_=]+|[\s_=]+$/g, "");

  // Handle negative (parentheses)
  const isNeg = s.includes("(") && s.includes(")");
  s = s.replace(/[()]/g, "");

  // Remove Rp prefix
  s = s.replace(/^[Rr][Pp]\.?\s*/, "");

  // Indonesian thousands separator: 1.000.000
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  } else if (s.includes(",") && s.includes(".")) {
    // Mixed (OCR error) Ã¢ÂÂ treat both as thousand separators
    s = s.replace(/[,.]/g, "");
  } else if (s.includes(",")) {
    s = s.replace(/,/g, "");
  } else {
    s = s.replace(/\./g, "");
  }

  const val = parseFloat(s);
  if (isNaN(val)) return null;
  return isNeg ? -val : val;
}

/* ------------------------------------------------------------------ */
/*  Row grouping                                                       */
/* ------------------------------------------------------------------ */

function groupIntoRows(words: OcrWord[], yThreshold = 25): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: OcrWord[][] = [];
  let current: OcrWord[] = [];
  let lastY = -100;

  for (const w of sorted) {
    if (Math.abs(w.y - lastY) > yThreshold && current.length > 0) {
      rows.push(current.sort((a, b) => a.x - b.x));
      current = [];
    }
    current.push(w);
    lastY = w.y;
  }
  if (current.length > 0) {
    rows.push(current.sort((a, b) => a.x - b.x));
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Layout detection                                                   */
/* ------------------------------------------------------------------ */

function detectSideBySide(words: OcrWord[], pageWidth: number): boolean {
  const midX = pageWidth / 2;
  const rows = groupIntoRows(words);

  let bothSides = 0;
  for (const row of rows) {
    const labelsLeft = row.filter(
      (w) => w.x < midX * 0.8 && isLabelWord(w.text)
    );
    const labelsRight = row.filter(
      (w) => w.x > midX && isLabelWord(w.text)
    );
    if (labelsLeft.length > 0 && labelsRight.length > 0) {
      bothSides++;
    }
  }
  return bothSides >= 5;
}

/* ------------------------------------------------------------------ */
/*  Header area detection                                              */
/* ------------------------------------------------------------------ */

function detectHeaderEnd(
  rows: OcrWord[][],
  pageHeight: number
): number {
  const keywords = [
    "PENERIMAAN",
    "AKTIVA",
    "PASSIVA",
    "PENDAPATAN",
    "BIAYA",
    "NERACA",
    "LABA",
    "LAPORAN",
  ];

  for (let i = 0; i < rows.length; i++) {
    const y = rows[i][0].y;
    if (y < pageHeight * 0.12) continue; // Skip top 12%

    const text = rows[i].map((w) => w.text).join(" ").toUpperCase();

    // Check for title row like "LAPORAN LABA RUGI" or "NERACA"
    if (
      keywords.some((kw) => text.includes(kw)) &&
      text.length < 80
    ) {
      // Find the next row with actual data (Rp or first content row)
      for (let j = i + 1; j < rows.length; j++) {
        const nextText = rows[j].map((w) => w.text).join(" ");
        if (
          nextText.includes("Rp") ||
          keywords.some((kw) => nextText.toUpperCase().includes(kw))
        ) {
          return j;
        }
      }
      return i + 1;
    }
  }

  // Fallback: skip top 20%
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0].y > pageHeight * 0.2) return i;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/*  Footer area detection                                              */
/* ------------------------------------------------------------------ */

function isFooterRow(row: OcrWord[], pageHeight: number): boolean {
  const y = row[0].y;
  if (y < pageHeight * 0.8) return false;

  const text = row
    .map((w) => w.text)
    .join(" ")
    .toLowerCase();

  // Common footer patterns
  if (/\b(direktur|medan|april|ttd|tanda\s*tangan)\b/i.test(text))
    return true;
  // If only a few short words near bottom Ã¢ÂÂ likely footer
  if (row.length <= 3 && y > pageHeight * 0.85) return true;

  return false;
}

/* ------------------------------------------------------------------ */
/*  Single-column parser (P&L)                                         */
/* ------------------------------------------------------------------ */

function parseSingleColumn(
  rows: OcrWord[][],
  startIdx: number,
  pageHeight: number
): RowData[] {
  const result: RowData[] = [];

  // Detect x-position thresholds for sub-value vs main-value columns
  // by analyzing where numbers appear
  const numberPositions: number[] = [];
  for (const row of rows.slice(startIdx)) {
    for (const w of row) {
      if (isNumericWord(w.text)) {
        numberPositions.push(w.x);
      }
    }
  }

  // Cluster number positions into sub (left cluster) and main (right cluster)
  numberPositions.sort((a, b) => a - b);
  let mainThreshold = 1750; // default
  if (numberPositions.length > 5) {
    // Find the largest gap in number positions
    let maxGap = 0;
    let gapPos = mainThreshold;
    for (let i = 1; i < numberPositions.length; i++) {
      const gap = numberPositions[i] - numberPositions[i - 1];
      if (gap > maxGap && gap > 100) {
        maxGap = gap;
        gapPos = (numberPositions[i] + numberPositions[i - 1]) / 2;
      }
    }
    if (maxGap > 100) mainThreshold = gapPos;
  }

  for (const row of rows.slice(startIdx)) {
    if (isFooterRow(row, pageHeight)) continue;

    const labelParts: string[] = [];
    let subValue: number | null = null;
    let mainValue: number | null = null;

    for (const w of row) {
      if (w.text === "Rp" || w.text === "Rp.") continue;

      if (isNumericWord(w.text)) {
        const num = cleanNumber(w.text);
        if (num !== null) {
          if (w.x > mainThreshold) {
            mainValue = num;
          } else {
            subValue = num;
          }
        }
      } else {
        const cleaned = w.text.replace(/^[_=|]+|[_=|]+$/g, "");
        if (cleaned && cleaned !== "-" && cleaned !== ":" && cleaned !== ".") {
          labelParts.push(cleaned);
        }
      }
    }

    const label = labelParts.join(" ").trim();
    if (!label && subValue === null && mainValue === null) continue;

    // Detect row type
    const isHeader =
      label.length > 3 &&
      label === label.toUpperCase() &&
      subValue === null &&
      mainValue === null &&
      !/\d/.test(label);

    const isTotal =
      /^(total|jumlah|laba)/i.test(label) && mainValue !== null;

    const isIndented = row[0].x > 530;

    // Check if label starts with a number (numbered items)
    const numMatch = label.match(/^(\d+)\s+(.+)/);
    const isNumbered = numMatch !== null;
    const rowNumber = numMatch ? numMatch[1] : "";
    const cleanLabel = numMatch ? numMatch[2] : label;

    result.push({
      label: cleanLabel,
      subValue,
      mainValue,
      isHeader,
      isTotal,
      isIndented: isIndented && !isNumbered,
      isNumbered,
      rowNumber,
    });
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Side-by-side parser (Balance Sheet)                                */
/* ------------------------------------------------------------------ */

function parseSideBySide(
  rows: OcrWord[][],
  startIdx: number,
  pageWidth: number,
  pageHeight: number
): { leftRows: RowData[]; rightRows: RowData[] } {
  const midX = pageWidth / 2;
  const leftResult: RowData[] = [];
  const rightResult: RowData[] = [];

  // Detect value column thresholds for each side
  const leftMainThreshold = midX * 0.8;
  const rightMainThreshold = pageWidth * 0.75;

  for (const row of rows.slice(startIdx)) {
    if (isFooterRow(row, pageHeight)) continue;

    const leftWords = row.filter((w) => w.x < midX - 50);
    const rightWords = row.filter((w) => w.x >= midX - 50);

    // Parse each side
    for (const [sideWords, sideResult, threshold] of [
      [leftWords, leftResult, leftMainThreshold],
      [rightWords, rightResult, rightMainThreshold],
    ] as [OcrWord[], RowData[], number][]) {
      if (sideWords.length === 0) continue;

      const labelParts: string[] = [];
      let subValue: number | null = null;
      let mainValue: number | null = null;

      for (const w of sideWords) {
        if (w.text === "Rp" || w.text === "Rp.") continue;

        if (isNumericWord(w.text)) {
          const num = cleanNumber(w.text);
          if (num !== null) {
            if (w.x > threshold) {
              mainValue = num;
            } else {
              subValue = num;
            }
          }
        } else {
          const cleaned = w.text.replace(/^[_=|.]+|[_=|.]+$/g, "");
          if (
            cleaned &&
            cleaned !== "-" &&
            cleaned !== ":" &&
            !cleaned.match(/^[|D]\.$/)
          ) {
            labelParts.push(cleaned);
          }
        }
      }

      const label = labelParts.join(" ").trim();
      if (!label && subValue === null && mainValue === null) continue;

      const sectionKeywords = [
        "Aktiva",
        "Passiva",
        "Lancar",
        "Tetap",
        "Ekuitas",
        "Hutang",
      ];
      const isHeader =
        label.length > 0 &&
        subValue === null &&
        mainValue === null &&
        sectionKeywords.some((kw) => label.includes(kw));

      const isTotal = /^(total|jumlah)/i.test(label);

      sideResult.push({
        label,
        subValue,
        mainValue,
        isHeader,
        isTotal,
        isIndented: false,
        isNumbered: false,
        rowNumber: "",
      });
    }
  }

  return { leftRows: leftResult, rightRows: rightResult };
}

/* ------------------------------------------------------------------ */
/*  Phase 1 Ã¢ÂÂ Extract from PDF                                        */
/* ------------------------------------------------------------------ */

export async function extractFromPdf(
  file: File,
  onProgress?: (update: ProcessingUpdate) => void
): Promise<PdfExtractionResult> {
  const report = (progress: number, status: string) =>
    onProgress?.({ progress, status });

  report(2, "Loading PDF...");

  // Dynamically import pdf.js
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdfDoc.numPages;

  report(5, `PDF loaded Ã¢ÂÂ ${totalPages} page(s)`);

  // Dynamically import Tesseract.js
  report(8, "Loading OCR engine...");
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("ind+eng", 1, {
    logger: (m: { progress: number; status: string }) => {
      if (m.status === "recognizing text") {
        // Don't override main progress here
      }
    },
  });

  const pages: PageData[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pageBaseProgress = 10 + ((pageNum - 1) / totalPages) * 80;
    const pageProgressRange = 80 / totalPages;

    report(
      pageBaseProgress,
      `Processing page ${pageNum}/${totalPages}...`
    );

    // Render page to canvas
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 3.0 }); // 3x for good OCR quality
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    report(
      pageBaseProgress + pageProgressRange * 0.3,
      `OCR page ${pageNum}/${totalPages}...`
    );

    // Run OCR
    const {
      data: { words: ocrWords },
    } = await worker.recognize(canvas);

    // Convert to our word format
    const words: OcrWord[] = (ocrWords || [])
      .filter(
        (w: { text: string; confidence: number }) =>
          w.text.trim() && w.confidence > 10
      )
      .map(
        (w: {
          text: string;
          bbox: { x0: number; y0: number; x1: number; y1: number };
          confidence: number;
        }) => ({
          text: w.text.trim(),
          x: w.bbox.x0,
          y: w.bbox.y0,
          w: w.bbox.x1 - w.bbox.x0,
          h: w.bbox.y1 - w.bbox.y0,
          right: w.bbox.x1,
          conf: w.confidence,
        })
      );

    report(
      pageBaseProgress + pageProgressRange * 0.6,
      `Analyzing layout page ${pageNum}/${totalPages}...`
    );

    // Analyze layout
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;
    const rows = groupIntoRows(words);
    const startIdx = detectHeaderEnd(rows, pageHeight);
    const isSideBySide = detectSideBySide(words, pageWidth);

    report(
      pageBaseProgress + pageProgressRange * 0.8,
      `Structuring data page ${pageNum}/${totalPages}...`
    );

    const pageData: PageData = {
      pageNumber: pageNum,
      sheetName: `Halaman_${pageNum}`,
      isSideBySide,
    };

    if (isSideBySide) {
      const { leftRows, rightRows } = parseSideBySide(
        rows,
        startIdx,
        pageWidth,
        pageHeight
      );
      pageData.leftRows = leftRows;
      pageData.rightRows = rightRows;
      pageData.leftTitle = "Aktiva";
      pageData.rightTitle = "Passiva";
    } else {
      pageData.rows = parseSingleColumn(rows, startIdx, pageHeight);
    }

    pages.push(pageData);
  }

  await worker.terminate();

  report(92, "Extraction complete");

  return { pages, totalPages };
}

/* ------------------------------------------------------------------ */
/*  Phase 2 Ã¢ÂÂ Generate Excel                                           */
/* ------------------------------------------------------------------ */

export async function generateExcel(
  extraction: PdfExtractionResult,
  onProgress?: (update: ProcessingUpdate) => void
): Promise<Blob> {
  const report = (progress: number, status: string) =>
    onProgress?.({ progress, status });

  report(93, "Generating Excel...");

  // Dynamically import ExcelJS for browser compatibility
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.default.Workbook();

  // Styles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerFill: any = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9D9D9" },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalFill: any = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFF2CC" },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thinBorder: any = {
    top: { style: "thin" },
    left: { style: "thin" },
    right: { style: "thin" },
    bottom: { style: "thin" },
  };

  for (const page of extraction.pages) {
    const ws = wb.addWorksheet(page.sheetName);

    if (page.isSideBySide && page.leftRows && page.rightRows) {
      // ---- Side-by-side layout ----
      const leftHeaders = [
        page.leftTitle || "Left",
        "Rp",
        "Nilai",
      ];
      const rightHeaders = [
        page.rightTitle || "Right",
        "Rp",
        "Nilai",
      ];

      // Column headers
      leftHeaders.forEach((h, i) => {
        const cell = ws.getCell(1, i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 11 };
        cell.fill = headerFill;
        cell.alignment = { horizontal: "center" };
        cell.border = thinBorder;
      });

      // Gap column (D)
      const gapCol = 4;

      rightHeaders.forEach((h, i) => {
        const cell = ws.getCell(1, gapCol + i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 11 };
        cell.fill = headerFill;
        cell.alignment = { horizontal: "center" };
        cell.border = thinBorder;
      });

      // Write left data
      let rowNum = 2;
      for (const item of page.leftRows) {
        writeSideRow(ws, rowNum, 1, item, thinBorder, headerFill, totalFill);
        rowNum++;
      }

      // Write right data
      rowNum = 2;
      for (const item of page.rightRows) {
        writeSideRow(
          ws,
          rowNum,
          gapCol + 1,
          item,
          thinBorder,
          headerFill,
          totalFill
        );
        rowNum++;
      }

      // Column widths
      ws.getColumn(1).width = 35;
      ws.getColumn(2).width = 22;
      ws.getColumn(3).width = 22;
      ws.getColumn(4).width = 3;
      ws.getColumn(5).width = 35;
      ws.getColumn(6).width = 22;
      ws.getColumn(7).width = 22;
    } else if (page.rows) {
      // ---- Single-column layout ----
      const headers = ["No", "Keterangan", "Sub-Amount (Rp)", "Amount (Rp)"];
      headers.forEach((h, i) => {
        const cell = ws.getCell(1, i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 11 };
        cell.fill = headerFill;
        cell.alignment = { horizontal: "center" };
        cell.border = thinBorder;
      });

      let rowNum = 2;
      for (const item of page.rows) {
        const cellNo = ws.getCell(rowNum, 1);
        const cellLabel = ws.getCell(rowNum, 2);
        const cellSub = ws.getCell(rowNum, 3);
        const cellMain = ws.getCell(rowNum, 4);

        cellNo.value = item.rowNumber ? parseInt(item.rowNumber, 10) : null;
        cellLabel.value = item.label;
        cellSub.value = item.subValue;
        cellMain.value = item.mainValue;

        // Borders
        [cellNo, cellLabel, cellSub, cellMain].forEach((c) => {
          c.border = thinBorder;
        });

        // Alignment
        cellLabel.alignment = {
          horizontal: "left",
          indent: item.isIndented ? 2 : 0,
        };
        cellSub.alignment = { horizontal: "right" };
        cellMain.alignment = { horizontal: "right" };
        cellSub.numFmt = "#,##0";
        cellMain.numFmt = "#,##0";

        // Header style
        if (item.isHeader) {
          [cellNo, cellLabel, cellSub, cellMain].forEach((c) => {
            c.font = { bold: true, size: 11 };
            c.fill = headerFill;
          });
        }

        // Total style
        if (item.isTotal) {
          [cellNo, cellLabel, cellSub, cellMain].forEach((c) => {
            c.font = { bold: true, size: 11 };
            c.fill = totalFill;
          });
        }

        rowNum++;
      }

      // Column widths
      ws.getColumn(1).width = 6;
      ws.getColumn(2).width = 50;
      ws.getColumn(3).width = 22;
      ws.getColumn(4).width = 22;
    }
  }

  report(98, "Finalizing...");

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Helper to write a single row in side-by-side mode */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeSideRow(
  ws: any,
  rowNum: number,
  startCol: number,
  item: RowData,
  border: any,
  headerFill: any,
  totalFill: any
) {
  const cellLabel = ws.getCell(rowNum, startCol);
  const cellSub = ws.getCell(rowNum, startCol + 1);
  const cellMain = ws.getCell(rowNum, startCol + 2);

  cellLabel.value = item.label;
  cellSub.value = item.subValue;
  cellMain.value = item.mainValue;

  [cellLabel, cellSub, cellMain].forEach((c) => {
    c.border = border;
  });

  cellSub.alignment = { horizontal: "right" };
  cellMain.alignment = { horizontal: "right" };
  cellSub.numFmt = "#,##0";
  cellMain.numFmt = "#,##0";

  if (item.isHeader) {
    [cellLabel, cellSub, cellMain].forEach((c) => {
      c.font = { bold: true, size: 11 };
      c.fill = headerFill;
    });
  }

  if (item.isTotal) {
    [cellLabel, cellSub, cellMain].forEach((c) => {
      c.font = { bold: true, size: 11 };
      c.fill = totalFill;
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Main entry point (combines Phase 1 + Phase 2)                      */
/* ------------------------------------------------------------------ */

export async function convertPdfToExcel(
  file: File,
  onProgress?: (update: ProcessingUpdate) => void
): Promise<PdfToExcelResult> {
  const originalSize = file.size;

  const extraction = await extractFromPdf(file, onProgress);
  const blob = await generateExcel(extraction, onProgress);

  onProgress?.({ progress: 100, status: "Done!" });

  return {
    blob,
    pages: extraction.pages,
    originalSize,
    processedSize: blob.size,
  };
}
