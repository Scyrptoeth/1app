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

type AppState = 'upload' | 'processing' | 'preview' | 'exporting';

interface EditableRow {
  id: string;
  rowNumber: string;
  label: string;
  values: string[];
  isHeader: boolean;
  isTotal: boolean;
  indent: number;
}

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
  const [editableRows, setEditableRows] = useState<EditableRow[]>([]);
  const [editableHeaders, setEditableHeaders] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
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

      // Convert to editable format
      const editable: EditableRow[] = result.rows.map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber !== null ? String(row.rowNumber) : '',
        label: row.label,
        values: [...row.values],
        isHeader: row.isHeader,
        isTotal: row.isTotal,
        indent: row.indent,
      }));

      setEditableRows(editable);
      setEditableHeaders([...result.headers]);
      setState('preview');
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

  // ---- Cell Edit Handler ----
  const updateCell = useCallback(
    (rowId: string, field: 'rowNumber' | 'label' | 'value', value: string, valueIndex?: number) => {
      setEditableRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row;
          if (field === 'rowNumber') return { ...row, rowNumber: value };
          if (field === 'label') return { ...row, label: value };
          if (field === 'value' && valueIndex !== undefined) {
            const newValues = [...row.values];
            newValues[valueIndex] = value;
            return { ...row, values: newValues };
          }
          return row;
        })
      );
    },
    []
  );

  // ---- Add Row ----
  const addRow = useCallback(
    (afterId: string) => {
      const colCount = editableRows[0]?.values.length || 1;
      const newRow: EditableRow = {
        id: Math.random().toString(36).substring(2, 9),
        rowNumber: '',
        label: '',
        values: Array(colCount).fill(''),
        isHeader: false,
        isTotal: false,
        indent: 0,
      };

      setEditableRows((prev) => {
        const idx = prev.findIndex((r) => r.id === afterId);
        const newRows = [...prev];
        newRows.splice(idx + 1, 0, newRow);
        return newRows;
      });
    },
    [editableRows]
  );

  // ---- Delete Row ----
  const deleteRow = useCallback((rowId: string) => {
    setEditableRows((prev) => prev.filter((r) => r.id !== rowId));
  }, []);

  // ---- Toggle Row Type ----
  const toggleRowType = useCallback(
    (rowId: string, field: 'isHeader' | 'isTotal') => {
      setEditableRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row;
          return { ...row, [field]: !row[field] };
        })
      );
    },
    []
  );

  // ---- Export to Excel ----
  const handleExport = useCallback(async () => {
    setState('exporting');
    try {
      // Convert editable rows back to RowData format
      const rows: RowData[] = editableRows.map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber ? parseInt(row.rowNumber) || null : null,
        label: row.label,
        values: row.values,
        indent: row.indent,
        isHeader: row.isHeader,
        isSectionTitle: row.isHeader,
        isTotal: row.isTotal,
      }));

      const blob = await generateExcel(
        rows,
        editableHeaders,
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

      setState('preview');
    } catch (err) {
      console.error('Excel generation failed:', err);
      setError(
        `Excel generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
      setState('preview');
    }
  }, [editableRows, editableHeaders, fileName]);

  // ---- Reset ----
  const handleReset = useCallback(() => {
    setState('upload');
    setProgress({ progress: 0, status: '' });
    setImagePreviewUrl('');
    setExtractionResult(null);
    setEditableRows([]);
    setEditableHeaders([]);
    setConfidence(0);
    setError('');
    setFileName('');
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
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <a href="/" className="text-sm text-blue-600 hover:underline">
              ← Back to 1APP
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
              ↺ Start Over
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
            <button
              onClick={() => setError('')}
              className="float-right text-red-500 hover:text-red-700"
            >
              ✕
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
            <div className="text-6xl mb-4">📊</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">
              Upload an image to extract data
            </h2>
            <p className="text-gray-500 mb-4">
              Supports PNG, JPEG, JPG — financial reports, tables, invoices, receipts
            </p>
            <p className="text-sm text-gray-400">
              Drag & drop or click to browse
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

        {/* ============ PREVIEW STATE ============ */}
        {(state === 'preview' || state === 'exporting') && (
          <div className="space-y-6">
            {/* Stats bar */}
            <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-6 text-sm">
                <span className="text-gray-500">
                  <strong className="text-gray-900">{editableRows.length}</strong>{' '}
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
                {confidence < 80 && (
                  <span className="text-amber-600 text-xs bg-amber-50 px-2 py-1 rounded">
                    ⚠ Low confidence — please review and correct cells below
                  </span>
                )}
              </div>

              <button
                onClick={handleExport}
                disabled={state === 'exporting'}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400
                           text-white font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {state === 'exporting' ? (
                  <>
                    <span className="animate-spin">⏳</span> Generating...
                  </>
                ) : (
                  <>📥 Export to Excel</>
                )}
              </button>
            </div>

            {/* Layout: Image + Table side by side on desktop */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Image reference (collapsible on mobile) */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-xl shadow-sm border p-4 sticky top-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    Original Image
                  </h3>
                  {imagePreviewUrl && (
                    <img
                      src={imagePreviewUrl}
                      alt="Original"
                      className="w-full rounded-lg border"
                    />
                  )}
                </div>
              </div>

              {/* Editable Table */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-xl shadow-sm border">
                  <div className="p-4 border-b flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Extracted Data (click cells to edit)
                    </h3>
                    <span className="text-xs text-gray-400">
                      {editableHeaders.length} columns
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="px-2 py-2 text-center text-xs text-gray-500 w-8">
                            #
                          </th>
                          {editableHeaders.map((header, hi) => (
                            <th
                              key={hi}
                              className="px-3 py-2 text-left text-xs font-semibold text-gray-600"
                            >
                              {header}
                            </th>
                          ))}
                          <th className="px-2 py-2 text-center text-xs text-gray-500 w-20">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {editableRows.map((row, ri) => (
                          <tr
                            key={row.id}
                            className={`border-b hover:bg-blue-50 transition-colors ${
                              row.isHeader
                                ? 'bg-gray-100 font-bold'
                                : row.isTotal
                                  ? 'bg-yellow-50 font-bold'
                                  : ''
                            }`}
                          >
                            {/* Row index */}
                            <td className="px-2 py-1 text-center text-xs text-gray-400">
                              {ri + 1}
                            </td>

                            {/* No column */}
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={row.rowNumber}
                                onChange={(e) =>
                                  updateCell(row.id, 'rowNumber', e.target.value)
                                }
                                className="w-full px-1 py-0.5 text-center text-xs bg-transparent
                                           border border-transparent hover:border-gray-300 focus:border-blue-400
                                           focus:outline-none rounded"
                              />
                            </td>

                            {/* Keterangan column */}
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={row.label}
                                onChange={(e) =>
                                  updateCell(row.id, 'label', e.target.value)
                                }
                                        }
                                  className={`w-full px-1 py-0.5 text-xs bg-transparent
                                           border border-transparent hover:border-gray-300 focus:border-blue-400
                                           focus:outline-none rounded ${
                                             row.isHeader || row.isTotal
                                               ? 'font-bold'
                                               : ''
                                           }`}
                                style={{
                                  paddingLeft: `${row.indent * 16 + 4}px`,
                                }}
                              />
                            </td>

                            {/* Value columns */}
                            {row.values.map((val, vi) => (
                              <td key={vi} className="px-2 py-1">
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e) =>
                                    updateCell(
                                      row.id,
                                      'value',
                                      e.target.value,
                                      vi
                                    )
                                  }
                                  className="w-full px-1 py-0.5 text-xs text-right bg-transparent
                                             border border-transparent hover:border-gray-300 focus:border-blue-400
                                             focus:outline-none rounded font-mono"
                                  placeholder="—"
                                />
                              </td>
                            ))}

                            {/* Actions */}
                            <td className="px-2 py-1 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => addRow(row.id)}
                                  title="Add row below"
                                  className="text-xs text-gray-400 hover:text-green-600 px-1"
                                >
                                  +
                                </button>
                                <button
                                  onClick={() => deleteRow(row.id)}
                                  title="Delete row"
                                  className="text-xs text-gray-400 hover:text-red-600 px-1"
                                >
                                  ✕
                                </button>
                                <button
                                  onClick={() =>
                                    toggleRowType(row.id, 'isHeader')
                                  }
                                  title="Toggle header"
                                  className={`text-xs px-1 ${
                                    row.isHeader
                                      ? 'text-blue-600'
                                      : 'text-gray-400 hover:text-blue-600'
                                  }`}
                                >
                                   H
                                </button>
                                <button
                                  onClick={() =>
                                    toggleRowType(row.id, 'isTotal')
                                  }
                                  title="Toggle total"
                                  className={`text-xs px-1 ${
                                    row.isTotal
                                      ? 'text-amber-600'
                                      : 'text-gray-400 hover:text-amber-600'
                                  }`}
                                >
                                  T
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Table footer */}
                  <div className="p-3 border-t bg-gray-50 flex justify-between items-center text-xs text-gray-500">
                    <div className="flex gap-4">
                      <span>
                        <span className="inline-block w-3 h-3 bg-gray-100 border mr-1 align-middle" />{' '}
                        Header
                      </span>
                      <span>
                        <span className="inline-block w-3 h-3 bg-yellow-50 border mr-1 align-middle" />{' '}
                        Total/Subtotal
                      </span>
                    </div>
                    <div>
                      <strong>H</strong> = Toggle Header &nbsp;|&nbsp;{' '}
                      <strong>T</strong> = Toggle Total &nbsp;|&nbsp;{' '}
                      <strong>+</strong> = Add Row &nbsp;|&nbsp;{' '}
                      <strong>✕</strong> = Delete Row
                    </div>
                  </div>
                </div>

                {/* Export button (bottom) */}
                <div className="mt-4 text-center">
                  <button
                    onClick={handleExport}
                    disabled={state === 'exporting'}
                    className="px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400
                               text-white font-semibold rounded-xl transition-colors text-base shadow-lg"
                  >
                    {state === 'exporting'
                      ? '⏳ Generating Excel...'
                      : '📥 Export to Excel (.xlsx)'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
