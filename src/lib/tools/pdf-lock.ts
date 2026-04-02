import { PDFDocument } from "pdf-lib-plus-encrypt";

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface LockPdfPermissions {
  /** Block copy/select text */
  blockCopying: boolean;
  /** Block printing */
  blockPrinting: boolean;
  /** Block editing/modifying content */
  blockModifying: boolean;
  /** Block annotations */
  blockAnnotating: boolean;
  /** Block filling forms */
  blockFillingForms: boolean;
  /** Block page assembly (insert/rotate/delete) */
  blockAssembly: boolean;
}

export interface LockPdfOptions {
  file: File;
  password: string;
  permissions: LockPdfPermissions;
  onProgress?: (update: ProcessingUpdate) => void;
}

export interface LockPdfResult {
  blob: Blob;
  fileName: string;
  originalSize: number;
  processedSize: number;
  appliedRestrictions: string[];
}

const RESTRICTION_LABELS: Record<keyof LockPdfPermissions, string> = {
  blockCopying: "Copy/Select text",
  blockPrinting: "Print",
  blockModifying: "Edit/Modify content",
  blockAnnotating: "Annotate",
  blockFillingForms: "Fill Forms",
  blockAssembly: "Assembly (insert/rotate/delete pages)",
};

export async function lockPdf(options: LockPdfOptions): Promise<LockPdfResult> {
  const { file, password, permissions, onProgress } = options;

  const report = (progress: number, status: string) => {
    onProgress?.({ progress, status });
  };

  // Step 1: Read the PDF file
  report(5, "Reading PDF file...");
  const arrayBuffer = await file.arrayBuffer();
  const originalSize = arrayBuffer.byteLength;

  // Step 2: Load with pdf-lib-plus-encrypt
  report(20, "Loading PDF document...");
  const pdfDoc = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
  });

  // Step 3: Build permission object
  report(40, "Configuring restrictions...");
  const securityOptions = {
    userPassword: "", // Anyone can open the PDF
    ownerPassword: password, // Owner password to remove restrictions
    permissions: {
      printing: permissions.blockPrinting ? false : "highResolution",
      modifying: !permissions.blockModifying,
      copying: !permissions.blockCopying,
      annotating: !permissions.blockAnnotating,
      fillingForms: !permissions.blockFillingForms,
      contentAccessibility: true, // Always allow accessibility
      documentAssembly: !permissions.blockAssembly,
    },
  };

  // Step 4: Apply encryption
  report(60, "Applying encryption...");
  await pdfDoc.encrypt(securityOptions);

  // Step 5: Save the encrypted PDF
  report(80, "Saving encrypted PDF...");
  const encryptedBytes = await pdfDoc.save();

  // Step 6: Create result
  report(95, "Preparing download...");
  const blob = new Blob([encryptedBytes], { type: "application/pdf" });
  const processedSize = encryptedBytes.byteLength;

  // Build list of applied restrictions
  const appliedRestrictions = (
    Object.keys(permissions) as Array<keyof LockPdfPermissions>
  )
    .filter((key) => permissions[key])
    .map((key) => RESTRICTION_LABELS[key]);

  const baseName = file.name.replace(/\.pdf$/i, "");
  const fileName = `${baseName}-locked.pdf`;

  report(100, "Done!");

  return {
    blob,
    fileName,
    originalSize,
    processedSize,
    appliedRestrictions,
  };
}
