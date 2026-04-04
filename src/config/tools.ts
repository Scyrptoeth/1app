export interface ToolConfig {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: string; // Lucide icon name
  route: string;
  accentColor: string; // Tailwind color class
  inputFormats: string[];
  outputFormats: string[];
  isAvailable: boolean; // false = coming soon
}

export type ToolCategory =
  | "watermark"
  | "convert"
  | "transform"
  | "extract"
  | "merge"
  | "compress"
  | "ocr"
  | "protect"
  | "split"
  | "rotate";

export const categoryLabels: Record<ToolCategory, string> = {
  watermark: "Watermark",
  convert: "Extract",
  transform: "Convert",
  extract: "X Content",
  merge: "Merge",
  compress: "Compress",
  ocr: "OCR",
  protect: "Protect",
  split: "Split",
  rotate: "Rotate",
};

export const categoryColors: Record<ToolCategory, string> = {
  watermark: "bg-rose-500",
  convert: "bg-blue-500",
  transform: "bg-violet-500",
  extract: "bg-teal-500",
  merge: "bg-emerald-500",
  compress: "bg-amber-500",
  ocr: "bg-violet-500",
  protect: "bg-slate-700",
  split: "bg-cyan-500",
  rotate: "bg-orange-500",
};

export const tools: ToolConfig[] = [
  {
    id: "image-watermark-remove",
    name: "Remove Image Watermark",
    description:
      "Automatically detect and remove watermarks from JPG, JPEG, and PNG images.",
    category: "watermark",
    icon: "ImageMinus",
    route: "/tools/image-watermark-remove",
    accentColor: "rose",
    inputFormats: [".jpg", ".jpeg", ".png"],
    outputFormats: [".jpg", ".jpeg", ".png"],
    isAvailable: true,
  },
  {
    id: "pdf-insert-watermark",
    name: "Insert PDF Watermark",
    description:
      "Add text or image watermark to PDF pages with customizable position, opacity, rotation, and mosaic pattern.",
    category: "watermark",
    icon: "Stamp",
    route: "/tools/pdf-insert-watermark",
    accentColor: "rose",
    inputFormats: [".pdf"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "pdf-watermark-remove",
    name: "Remove PDF Watermark",
    description:
      "Automatically detect and remove watermarks from PDF files, supporting multi-page documents.",
    category: "watermark",
    icon: "FileX2",
    route: "/tools/pdf-watermark-remove",
    accentColor: "rose",
    inputFormats: [".pdf"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "excel-to-pdf",
    name: "Excel to PDF",
    description:
      "Convert Excel spreadsheets (.xlsx) into PDF files, preserving cell styles, colors, borders, merged cells, and number formatting.",
    category: "transform",
    icon: "FileOutput",
    route: "/tools/excel-to-pdf",
    accentColor: "violet",
    inputFormats: [".xlsx", ".xls"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "image-to-pdf",
    name: "Image to PDF",
    description:
      "Convert one or more images (JPG, JPEG, PNG) into a single PDF file. Reorder, rotate, and customize page settings before download.",
    category: "transform",
    icon: "FileImage",
    route: "/tools/image-to-pdf",
    accentColor: "violet",
    inputFormats: [".jpg", ".jpeg", ".png"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "image-to-excel",
    name: "Image to Excel",
    description:
      "Extract tables and data from images into editable Excel files using OCR technology.",
    category: "convert",
    icon: "FileImage",
    route: "/tools/image-to-excel",
    accentColor: "blue",
    inputFormats: [".jpg", ".jpeg", ".png"],
    outputFormats: [".xlsx"],
    isAvailable: true,
  },
  {
    id: "pdf-to-excel",
    name: "PDF to Excel",
    description:
      "Extract tables, numbers, and structured data from PDF documents into formatted Excel spreadsheets.",
    category: "convert",
    icon: "FileSpreadsheet",
    route: "/tools/pdf-to-excel",
    accentColor: "blue",
    inputFormats: [".pdf"],
    outputFormats: [".xlsx"],
    isAvailable: true,
  },
  {
    id: "pdf-to-image",
    name: "PDF to Image",
    description:
      "Convert PDF documents into high-quality PNG images. Each page becomes a separate image file.",
    category: "transform",
    icon: "Images",
    route: "/tools/pdf-to-image",
    accentColor: "violet",
    inputFormats: [".pdf"],
    outputFormats: [".png"],
    isAvailable: true,
  },
  {
    id: "pdf-to-word",
    name: "PDF to Word",
    description:
      "Convert PDF documents into editable Word (.docx) files, preserving text formatting, fonts, and page layout.",
    category: "transform",
    icon: "FileType",
    route: "/tools/pdf-to-word",
    accentColor: "violet",
    inputFormats: [".pdf"],
    outputFormats: [".docx"],
    isAvailable: true,
  },
  {
    id: "pdf-to-ppt",
    name: "PDF to PowerPoint",
    description:
      "Convert PDF documents into editable PowerPoint (.pptx) presentations, preserving text positioning, fonts, and tables.",
    category: "transform",
    icon: "Presentation",
    route: "/tools/pdf-to-ppt",
    accentColor: "violet",
    inputFormats: [".pdf"],
    outputFormats: [".pptx"],
    isAvailable: true,
  },
  {
    id: "word-to-pdf",
    name: "Word to PDF",
    description:
      "Convert Word documents (.docx, .doc) into PDF files, preserving fonts, images, tables, charts, and all formatting.",
    category: "transform",
    icon: "FileOutput",
    route: "/tools/word-to-pdf",
    accentColor: "violet",
    inputFormats: [".docx", ".doc"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "pptx-to-pdf",
    name: "PowerPoint to PDF",
    description:
      "Convert PowerPoint presentations (.pptx, .ppt) into PDF files, preserving slide layout, images, shapes, and text formatting.",
    category: "transform",
    icon: "FileOutput",
    route: "/tools/pptx-to-pdf",
    accentColor: "violet",
    inputFormats: [".pptx", ".ppt"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "link-to-qr-code",
    name: "Link to QR Code",
    description:
      "Generate customizable QR codes from any URL or text. Choose frame styles, colors, and download as high-quality PNG.",
    category: "convert",
    icon: "QrCode",
    route: "/tools/link-to-qr-code",
    accentColor: "blue",
    inputFormats: ["URL"],
    outputFormats: [".png"],
    isAvailable: true,
  },
  {
    id: "qr-code-to-link",
    name: "QR Code to Link",
    description:
      "Decode QR codes from images to extract links and text. Supports single and multiple QR codes per image.",
    category: "convert",
    icon: "ScanLine",
    route: "/tools/qr-code-to-link",
    accentColor: "blue",
    inputFormats: [".jpg", ".jpeg", ".png"],
    outputFormats: ["Text/URL"],
    isAvailable: true,
  },
  {
    id: "x-content-to-pdf",
    name: "X Content to PDF",
    description:
      "Extract posts, threads, and articles from X (Twitter) into clean, formatted PDF documents.",
    category: "extract",
    icon: "FileText",
    route: "/tools/x-content-to-pdf",
    accentColor: "teal",
    inputFormats: ["URL"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "x-content-to-word",
    name: "X Content to Word",
    description:
      "Extract posts, threads, and articles from X (Twitter) into editable Word documents.",
    category: "extract",
    icon: "FileType",
    route: "/tools/x-content-to-word",
    accentColor: "teal",
    inputFormats: ["URL"],
    outputFormats: [".docx"],
    isAvailable: true,
  },
  {
    id: "compress-pdf",
    name: "Compress PDF",
    description:
      "Reduce PDF file size with three compression modes — choose between maximum compression or maximum quality.",
    category: "compress",
    icon: "FileDown",
    route: "/tools/compress-pdf",
    accentColor: "amber",
    inputFormats: [".pdf"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "compress-image",
    name: "Compress Image",
    description:
      "Reduce image file size while preserving dimensions. Supports JPEG quality adjustment and PNG color quantization.",
    category: "compress",
    icon: "ImageDown",
    route: "/tools/compress-image",
    accentColor: "amber",
    inputFormats: [".jpeg", ".jpg", ".png"],
    outputFormats: [".jpeg", ".jpg", ".png"],
    isAvailable: true,
  },
  {
    id: "pdf-lock",
    name: "Lock PDF",
    description:
      "Add password protection and restrictions to PDF files. Block copying, printing, editing, and more.",
    category: "protect",
    icon: "Lock",
    route: "/tools/pdf-lock",
    accentColor: "slate",
    inputFormats: [".pdf"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "pdf-merge",
    name: "Merge PDF",
    description:
      "Combine multiple PDF files into one. Reorder files or individual pages with drag & drop.",
    category: "merge",
    icon: "Combine",
    route: "/tools/pdf-merge",
    accentColor: "emerald",
    inputFormats: [".pdf"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "split-pdf",
    name: "Split PDF",
    description:
      "Split a PDF into multiple files. Reorder pages, create groups, and download individually or as ZIP.",
    category: "split",
    icon: "Scissors",
    route: "/tools/split-pdf",
    accentColor: "cyan",
    inputFormats: [".pdf"],
    outputFormats: [".pdf", ".zip"],
    isAvailable: true,
  },
  {
    id: "rotate-pdf",
    name: "Rotate PDF",
    description:
      "Rotate PDF pages individually or in bulk. Lossless rotation — original quality fully preserved.",
    category: "rotate",
    icon: "RotateCw",
    route: "/tools/rotate-pdf",
    accentColor: "orange",
    inputFormats: [".pdf"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "remove-page-pdf",
    name: "Remove Page PDF",
    description:
      "Remove one or more pages from a PDF file. Reorder remaining pages with drag & drop. Lossless — original quality preserved.",
    category: "split",
    icon: "FileX",
    route: "/tools/remove-page-pdf",
    accentColor: "cyan",
    inputFormats: [".pdf"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "reorder-pdf",
    name: "Reorder PDF",
    description:
      "Rearrange, reorder, and remove PDF pages with drag & drop. Lossless — original quality preserved.",
    category: "split",
    icon: "ArrowUpDown",
    route: "/tools/reorder-pdf",
    accentColor: "cyan",
    inputFormats: [".pdf"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
  {
    id: "scan-to-pdf",
    name: "Scan to PDF",
    description:
      "Scan documents using your camera and convert them into high-quality PDF files. Auto-enhance for optimal readability.",
    category: "transform",
    icon: "ScanLine",
    route: "/tools/scan-to-pdf",
    accentColor: "violet",
    inputFormats: ["Camera"],
    outputFormats: [".pdf"],
    isAvailable: true,
  },
];

export interface ToolSection {
  label: string;
  toolIds: string[];
}

export const SECTIONS: ToolSection[] = [
  {
    label: "Excel",
    toolIds: ["excel-to-pdf", "image-to-excel", "pdf-to-excel"],
  },
  {
    label: "Image",
    toolIds: ["image-to-excel", "image-to-pdf", "pdf-to-image"],
  },
  {
    label: "Image Utilities",
    toolIds: ["compress-image", "image-watermark-remove"],
  },
  {
    label: "PDF",
    toolIds: ["excel-to-pdf", "image-to-pdf", "pdf-to-excel", "pdf-to-image", "pdf-to-ppt", "pdf-to-word", "pptx-to-pdf", "scan-to-pdf", "word-to-pdf", "x-content-to-pdf"],
  },
  {
    label: "PDF Utilities",
    toolIds: ["compress-pdf", "pdf-insert-watermark", "pdf-lock", "pdf-merge", "pdf-watermark-remove", "remove-page-pdf", "reorder-pdf", "rotate-pdf", "split-pdf"],
  },
  {
    label: "PowerPoint",
    toolIds: ["pptx-to-pdf"],
  },
  {
    label: "QR Code",
    toolIds: ["link-to-qr-code", "qr-code-to-link"],
  },
  {
    label: "Scan",
    toolIds: ["scan-to-pdf"],
  },
  {
    label: "Watermark",
    toolIds: ["image-watermark-remove", "pdf-insert-watermark", "pdf-watermark-remove"],
  },
  {
    label: "Word",
    toolIds: ["word-to-pdf", "x-content-to-word"],
  },
  {
    label: "X Content",
    toolIds: ["x-content-to-pdf", "x-content-to-word"],
  },
];

export function getToolById(id: string): ToolConfig | undefined {
  return tools.find((t) => t.id === id);
}

export function getToolsByCategory(category: ToolCategory): ToolConfig[] {
  return tools.filter((t) => t.category === category);
}

export function getAvailableTools(): ToolConfig[] {
  return tools.filter((t) => t.isAvailable);
}

export function getAllCategories(): ToolCategory[] {
  const cats = new Set(tools.map((t) => t.category));
  return Array.from(cats);
}
