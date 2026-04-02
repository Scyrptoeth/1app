"use client";

import { useState, useCallback, useMemo } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  lockPdf,
  type ProcessingUpdate,
  type LockPdfResult,
  type LockPdfPermissions,
} from "@/lib/tools/pdf-lock";

type Stage = "upload" | "configure" | "processing" | "done";

const RESTRICTION_OPTIONS: Array<{
  key: keyof LockPdfPermissions;
  label: string;
  description: string;
}> = [
  {
    key: "blockOpening",
    label: "Require Password to Open",
    description: "Require password to view the PDF",
  },
  {
    key: "blockCopying",
    label: "Block Copy/Select Text",
    description: "Prevent copy-paste and text selection",
  },
  {
    key: "blockPrinting",
    label: "Block Printing",
    description: "Prevent printing the document",
  },
  {
    key: "blockModifying",
    label: "Block Edit/Modify",
    description: "Prevent modifying document content",
  },
  {
    key: "blockAnnotating",
    label: "Block Annotations",
    description: "Prevent adding or editing annotations",
  },
  {
    key: "blockFillingForms",
    label: "Block Fill Forms",
    description: "Prevent filling interactive form fields",
  },
  {
    key: "blockAssembly",
    label: "Block Assembly",
    description: "Prevent inserting, rotating, or deleting pages",
  },
];

function getPasswordStrength(password: string): {
  label: string;
  color: string;
  width: string;
} {
  if (password.length === 0) return { label: "", color: "", width: "w-0" };
  if (password.length < 4)
    return { label: "Weak", color: "bg-red-500", width: "w-1/3" };

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const varietyCount = [hasUpper, hasLower, hasNumber, hasSpecial].filter(
    Boolean
  ).length;

  if (password.length >= 8 && varietyCount >= 3)
    return { label: "Strong", color: "bg-emerald-500", width: "w-full" };
  if (password.length >= 6 && varietyCount >= 2)
    return { label: "Medium", color: "bg-amber-500", width: "w-2/3" };
  return { label: "Weak", color: "bg-red-500", width: "w-1/3" };
}

export default function PdfLockPage() {
  const tool = getToolById("pdf-lock")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<LockPdfResult | null>(null);

  // Configure stage state
  const [permissions, setPermissions] = useState<LockPdfPermissions>({
    blockOpening: false,
    blockCopying: false,
    blockPrinting: false,
    blockModifying: false,
    blockAnnotating: false,
    blockFillingForms: false,
    blockAssembly: false,
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const hasAnyRestriction = useMemo(
    () => Object.values(permissions).some(Boolean),
    [permissions]
  );

  const passwordsMatch = password === confirmPassword;
  const passwordStrength = getPasswordStrength(password);

  const canProceed =
    hasAnyRestriction &&
    password.length >= 1 &&
    confirmPassword.length >= 1 &&
    passwordsMatch;

  const handleFilesSelected = useCallback((files: File[]) => {
    setFile(files[0]);
    setStage("configure");
  }, []);

  const togglePermission = useCallback((key: keyof LockPdfPermissions) => {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const allSelected = useMemo(
    () => Object.values(permissions).every(Boolean),
    [permissions]
  );

  const toggleAllRestrictions = useCallback(() => {
    const newValue = !allSelected;
    setPermissions({
      blockOpening: newValue,
      blockCopying: newValue,
      blockPrinting: newValue,
      blockModifying: newValue,
      blockAnnotating: newValue,
      blockFillingForms: newValue,
      blockAssembly: newValue,
    });
  }, [allSelected]);

  const handleBackToConfigure = useCallback(() => {
    setStage("configure");
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, []);

  const handleLock = useCallback(async () => {
    if (!file || !canProceed) return;

    setStage("processing");

    try {
      const lockResult = await lockPdf({
        file,
        password,
        permissions,
        onProgress: (update) => setProgress(update),
      });
      setResult(lockResult);
      setStage("done");
    } catch (err) {
      console.error("PDF lock failed:", err);
      setStage("configure");
      alert(
        "Failed to lock the PDF. The file may be corrupted or unsupported. Please try a different file."
      );
    }
  }, [file, password, permissions, canProceed]);

  const handleDownload = useCallback(() => {
    if (!result) return;

    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result]);

  const handleReset = useCallback(() => {
    setStage("upload");
    setFile(null);
    setProgress({ progress: 0, status: "" });
    setResult(null);
    setPermissions({
      blockOpening: false,
      blockCopying: false,
      blockPrinting: false,
      blockModifying: false,
      blockAnnotating: false,
      blockFillingForms: false,
      blockAssembly: false,
    });
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ToolPageLayout tool={tool}>
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select a PDF to lock"
          subtitle="Add password protection and restrictions to your PDF"
        />
      )}

      {stage === "configure" && file && (
        <div className="max-w-lg mx-auto space-y-6">
          {/* File info */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-slate-400 shrink-0"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">
                {file.name}
              </p>
              <p className="text-xs text-slate-500">
                {formatFileSize(file.size)}
              </p>
            </div>
          </div>

          {/* Restrictions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Restrictions
              </h3>
              <button
                type="button"
                onClick={toggleAllRestrictions}
                className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="space-y-2">
              {RESTRICTION_OPTIONS.map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={permissions[opt.key]}
                    onChange={() => togglePermission(opt.key)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-900">
                      {opt.label}
                    </span>
                    <p className="text-xs text-slate-500">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
            {!hasAnyRestriction && (
              <p className="mt-2 text-xs text-amber-600">
                Select at least one restriction to continue.
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Owner Password
            </h3>
            <p className="text-xs text-slate-500">
              This password is required to remove restrictions. The PDF can
              still be opened and viewed by anyone.
            </p>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 pr-10 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            {/* Password strength */}
            {password.length > 0 && (
              <div className="space-y-1">
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${passwordStrength.color} ${passwordStrength.width} transition-all duration-300 rounded-full`}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Strength: {passwordStrength.label}
                </p>
              </div>
            )}

            {/* Confirm password */}
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-red-600">Passwords do not match.</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLock}
              disabled={!canProceed}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Lock PDF
            </button>
          </div>
        </div>
      )}

      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {stage === "done" && result && file && (
        <>
          <DownloadView
            fileName={result.fileName}
            fileSize={formatFileSize(result.processedSize)}
            onDownload={handleDownload}
            onReset={handleReset}
          />

          {/* Modify restrictions button */}
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={handleBackToConfigure}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Modify restrictions
            </button>
          </div>

          {/* File size comparison */}
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <span>
                {formatFileSize(result.originalSize)} &rarr;{" "}
                {formatFileSize(result.processedSize)}
              </span>
            </div>
          </div>

          {/* Applied restrictions */}
          {result.appliedRestrictions.length > 0 && (
            <div className="mt-4 mb-4 p-3 bg-slate-50 border border-slate-100 rounded-xl">
              <p className="text-xs font-medium text-slate-700 mb-2">
                Applied restrictions:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.appliedRestrictions.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-slate-200 text-slate-700 rounded-full"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <rect
                        x="3"
                        y="11"
                        width="18"
                        height="11"
                        rx="2"
                        ry="2"
                      />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Info Notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-blue-500 shrink-0 mt-0.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              The PDF can be opened and viewed by anyone. The owner password is
              required to remove or change the restrictions.
            </p>
          </div>
        </>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">
          How it works
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              step: "1",
              title: "Upload PDF",
              desc: "Select the PDF document you want to protect.",
            },
            {
              step: "2",
              title: "Set Restrictions",
              desc: "Choose which actions to block and set an owner password.",
            },
            {
              step: "3",
              title: "Download Locked PDF",
              desc: "Get your protected PDF with restrictions enforced.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="flex flex-col items-center text-center"
            >
              <div className="w-10 h-10 rounded-full bg-accent-50 flex items-center justify-center mb-3">
                <span className="text-sm font-bold text-accent-600">
                  {item.step}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                {item.title}
              </h3>
              <p className="text-xs text-slate-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </ToolPageLayout>
  );
}
