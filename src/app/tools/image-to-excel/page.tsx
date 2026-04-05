'use client';

import { useState, useCallback } from 'react';
import ToolPageLayout from '@/components/ToolPageLayout';
import FileUploader from '@/components/FileUploader';
import ProcessingView from '@/components/ProcessingView';
import { HowItWorks } from '@/components/HowItWorks';
import { getToolById } from '@/config/tools';
import {
  extractFromImage,
  generateExcel,
  type ProcessingUpdate,
  type ExtractionResult,
  type RowData,
} from '@/lib/tools/image-to-excel';

type Stage = 'upload' | 'processing' | 'preview';

export default function ImageToExcelPage() {
  const tool = getToolById('image-to-excel')!;

  const [stage, setStage] = useState<Stage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: '' });
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selected = files[0];
    setFile(selected);
    setStage('processing');

    try {
      const extraction = await extractFromImage(selected, (update) => setProgress(update));
      setResult(extraction);
      setStage('preview');
    } catch (err) {
      console.error('Extraction failed:', err);
      setStage('upload');
      alert(
        `Extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try a different image.`
      );
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!result || !file) return;
    setIsExporting(true);
    try {
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const blob = await generateExcel(result.rows, result.headers, baseName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel generation failed:', err);
      alert(`Failed to generate Excel: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  }, [result, file]);

  const handleReset = useCallback(() => {
    setStage('upload');
    setFile(null);
    setProgress({ progress: 0, status: '' });
    setResult(null);
    setIsExporting(false);
  }, []);

  return (
    <ToolPageLayout tool={tool}>
      <HowItWorks
        steps={[
          {
            step: "1",
            title: "Upload Image",
            desc: "Select a PNG, JPG, or JPEG image containing a table, financial report, or invoice.",
          },
          {
            step: "2",
            title: "OCR Extraction",
            desc: "Tesseract.js reads every number, label, and description using bilingual OCR (Indonesian and English).",
          },
          {
            step: "3",
            title: "Preview Data",
            desc: "Review the extracted data in a structured table. Columns and descriptions are detected automatically, with a confidence score shown.",
          },
          {
            step: "4",
            title: "Download Excel",
            desc: "Download a formatted .xlsx file with headers, number formatting, and auto-fit column widths. All processing happens in your browser.",
          },
        ]}
      />

      {stage === 'upload' && (
        <FileUploader
          acceptedFormats={['.png', '.jpg', '.jpeg']}
          maxSizeMB={20}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select an image to extract data from"
          subtitle="Supports PNG, JPG, JPEG — financial reports, tables, invoices"
        />
      )}

      {stage === 'processing' && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {stage === 'preview' && result && file && (
        <div className="w-full">
          {/* Preview Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Preview</h3>
              <p className="text-sm text-slate-500">
                {result.rows.length} rows extracted — review before downloading
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDownload}
                disabled={isExporting}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 disabled:opacity-60 transition-colors shadow-md shadow-accent-500/25"
              >
                {isExporting ? (
                  <>
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download .xlsx
                  </>
                )}
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Process Another
              </button>
            </div>
          </div>

          {/* Confidence badge */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${
              result.confidence >= 85
                ? 'bg-emerald-50 text-emerald-700'
                : result.confidence >= 65
                ? 'bg-amber-50 text-amber-700'
                : 'bg-red-50 text-red-700'
            }`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
              </svg>
              Image Data Quality: {result.confidence.toFixed(1)}%
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Extraction accuracy depends on Image Data Quality — the higher the score, the more precise the extracted data. For best results, use high-resolution images with clear, high-contrast text.
            </p>
          </div>

          {/* Info Notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Output quality depends on image resolution and text clarity. High-contrast images with clear text produce the most accurate Excel data.
            </p>
          </div>

          {/* Table Preview */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <ImagePreviewTable rows={result.rows} headers={result.headers} />
            </div>
          </div>

          {/* File info */}
          <div className="mt-4 flex items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>{file.name}</span>
            </div>
            <div className="text-slate-300">|</div>
            <div>{result.imageWidth} × {result.imageHeight} px</div>
          </div>
        </div>
      )}
    </ToolPageLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Preview Table Component                                             */
/* ------------------------------------------------------------------ */

function ImagePreviewTable({
  rows,
  headers,
}: {
  rows: RowData[];
  headers: string[];
}) {
  // headers = [labelCol, ...yearCols, descCol]
  // rows have: label, values[], description
  const labelHeader = headers[0] ?? 'Uraian';
  const valueHeaders = headers.slice(1, headers.length - 1);
  const descHeader = headers[headers.length - 1] ?? 'Description';

  const formatNum = (val: string): string => {
    if (!val || val === '-') return val;
    const n = parseFloat(val.replace(/\./g, '').replace(',', '.'));
    if (isNaN(n)) return val;
    return n.toLocaleString('id-ID');
  };

  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-100 sticky top-0">
        <tr>
          <th className="px-3 py-2.5 text-left font-semibold text-slate-700 min-w-[200px]">
            {labelHeader}
          </th>
          {valueHeaders.map((h) => (
            <th key={h} className="px-3 py-2.5 text-right font-semibold text-slate-700 w-36 whitespace-nowrap">
              {h}
            </th>
          ))}
          <th className="px-3 py-2.5 text-left font-semibold text-slate-700 min-w-[160px]">
            {descHeader}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={idx}
            className={`border-t border-slate-100 ${
              row.isHeader || row.isSectionTitle
                ? 'bg-slate-50'
                : row.isTotal
                ? 'bg-amber-50'
                : 'hover:bg-slate-50/50'
            }`}
          >
            {/* Label column */}
            <td
              className={`px-3 py-2 text-slate-800 ${
                row.isHeader || row.isTotal ? 'font-semibold' : ''
              }`}
              style={{ paddingLeft: `${12 + row.indent * 16}px` }}
            >
              {row.label}
            </td>

            {/* Value columns */}
            {valueHeaders.map((_, vi) => (
              <td
                key={vi}
                className={`px-3 py-2 text-right font-mono ${
                  row.isTotal ? 'font-semibold text-slate-900' : 'text-slate-700'
                }`}
              >
                {formatNum(row.values[vi] ?? '')}
              </td>
            ))}

            {/* Description column */}
            <td className="px-3 py-2 text-slate-500 text-xs">
              {row.description || ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
