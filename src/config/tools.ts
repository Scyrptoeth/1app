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
  | "split";

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
];

export interface ToolSection {
  label: string;
  toolIds: string[];
}

export const SECTIONS: ToolSection[] = [
  {
    label: "Watermark",
    toolIds: ["image-watermark-remove", "pdf-watermark-remove"],
  },
  {
    label: "Convert from PDF",
    toolIds: ["pdf-to-image", "pdf-to-excel", "pdf-to-word", "pdf-to-ppt"],
  },
  {
    label: "Convert to Excel",
    toolIds: ["image-to-excel", "pdf-to-excel"],
  },
  {
    label: "Convert to Image",
    toolIds: ["pdf-to-image"],
  },
  {
    label: "Convert from Image",
    toolIds: ["image-to-excel"],
  },
  {
    label: "Convert from Word",
    toolIds: ["word-to-pdf"],
  },
  {
    label: "Convert from PowerPoint",
    toolIds: ["pptx-to-pdf"],
  },
  {
    label: "Extract from X",
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
