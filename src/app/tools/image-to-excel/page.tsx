'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  extractFromImage,
  generateExcel,
  type ProcessingUpdate,
  type ExtractionResult,
  type RowData,
} from '@/lib/tools/image-to-excel';

// ============================================================
// Types
// ============================================================

type AppState = 'upload' | 'processing' | 'result';

// ============================================================
// Main Page Component
// ============================================================

export default function ImageToExcelPage() {
  const [state, setState] = useState<AppState>('upload');
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: '',
  });
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');
  const [extractionResult, setExtractionResult] =
    useState<ExtractionResult | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- File Upload Handler ----
  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPEG, JPG).');
      return;
    }

    setError('');
    setFileName(file.name);
    setImagePreviewUrl(URL.createObjectURL(file));
    setState('processing');
    setProgress({ progress: 0, status: 'Starting...' });

    try {
      const result = await extractFromImage(file, (update) => {
        setProgress(update);
      });

      setExtractionResult(result);
      setConfidence(result.confidence);
      setState('result');
    } catch (err) {
      console.error('Extraction failed:', err);
      setError(
        `Extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
      setState('upload');
    }
  }, []);

  // ---- Drag & Drop ----
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ---- Export to Excel ----
  const handleExport = useCallback(async () => {
    if (!extractionResult) return;
    setIsExporting(true);
    try {
      const blob = await generateExcel(
        extractionResult.rows,
        extractionResult.headers,
        fileName.replace(/\.[^/.]+$/, '') || 'Extracted Data'
      );

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/\.[^/.]+$/, '') || 'extracted-data'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel generation failed:', err);
      setError(
        `Excel generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setIsExporting(false);
    }
  }, [extractionResult, fileName]);

  // ---- Reset ----
  const handleReset = useCallback(() => {
    setState('upload');
    setProgress({ progress: 0, status: '' });
    setImagePreviewUrl('');
    setExtractionResult(null);
    setConfidence(0);
    setError('');
    setFileName('');
    setIsExporting(false);
  }, []);

  // ---- Cleanup ----
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <a href="/" className="text-sm text-blue-600 hover:underline">
              &larr; Back to 1APP
            </a>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              Image to Excel
            </h1>
            <p className="text-sm text-gray-500">
              Convert data from images to formatted Excel spreadsheets
            </p>
          </div>
          {state !== 'upload' && (
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              &#8634; Start Over
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
            <button
              onClick={() => setError('')}
              className="float-right text-red-500 hover:text-red-700"
            >
              &#10005;
            </button>
          </div>
        )}

        {/* ============ UPLOAD STATE ============ */}
        {state === 'upload' && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl p-16 text-center cursor-pointer
                       hover:border-blue-400 hover:bg-blue-50 transition-all"
          >
            <div className="text-6xl mb-4">&#128202;</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">
              Upload an image to extract data
            </h2>
            <p className="text-gray-500 mb-4">
              Supports PNG, JPEG, JPG &mdash; financial reports, tables, invoices, receipts
            </p>
            <p className="text-sm text-gray-400">
              Drag &amp; drop or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>
        )}

        {/* ============ PROCESSING STATE ============ */}
        {state === 'processing' && (
          <div className="bg-white rounded-xl shadow-sm border p-8">
            <div className="max-w-lg mx-auto text-center">
              {/* Image preview */}
              {imagePreviewUrl && (
                <div className="mb-6">
                  <img
                    src={imagePreviewUrl}
                    alt="Uploaded"
                    className="max-h-48 mx-auto rounded-lg shadow-sm opacity-70"
                  />
                </div>
              )}

              <h2 className="text-lg font-semibold text-gray-700 mb-4">
                Processing: {fileName}
              </h2>

              {/* Progress bar */}
              <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>

              <p className="text-sm text-gray-500">{progress.status}</p>
              <p className="text-xs text-gray-400 mt-1">
                {progress.progress}% complete
              </p>

              {progress.progress < 50 && (
                <p className="text-xs text-amber-600 mt-4">
                  First-time OCR may take 30-60 seconds to download language data.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ============ RESULT STATE ============ */}
        {state === 'result' && extractionResult && (
          <div className="space-y-6">
            {/* Stats bar */}
            <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-6 text-sm">
                <span className="text-gray-500">
                  <strong className="text-gray-900">{extractionResult.rows.length}</strong>{' '}
                  rows extracted
                </span>
                <span className="text-gray-500">
                  OCR Confidence:{' '}
                  <strong
                    className={
                      confidence >= 70
                        ? 'text-green-600'
                        : confidence >= 50
                          ? 'text-amber-600'
                          : 'text-red-600'
                    }
                  >
                    {confidence.toFixed(1)}%
                  </strong>
                </span>
                <span className="text-gray-500">
                  <strong className="text-gray-900">{extractionResult.columnCount}</strong>{' '}
                  value columns detected
                </span>
              </div>
            </div>

            {/* Image preview + Export */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {/* Image */}
              <div className="p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">
                  Original Image
                </h3>
                {imagePreviewUrl && (
                  <div className="flex justify-center">
                    <img
                      src={imagePreviewUrl}
                      alt="Original"
                      className="max-h-[500px] rounded-lg border shadow-sm"
                    />
                  </div>
                )}
              </div>

              {/* Export section */}
              <div className="border-t bg-gray-50 p-6 text-center">
                <p className="text-sm text-gray-600 mb-4">
                  Data has been extracted and formatted. Click below to download your Excel file.
                </p>
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  className="px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400
                             text-white font-semibold rounded-xl transition-colors text-base shadow-lg
                             inline-flex items-center gap-2"
                >
                  {isExporting ? (
                    <>
                      <span className="animate-spin">&#9203;</span> Generating Excel...
                    </>
                  ) : (
                    <>&#128229; Export to Excel (.xlsx)</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
