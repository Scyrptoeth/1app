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
  | "merge"
  | "compress"
  | "ocr"
  | "protect"
  | "split";

export const categoryLabels: Record<ToolCategory, string> = {
  watermark: "Watermark",
  convert: "Convert",
  merge: "Merge",
  compress: "Compress",
  ocr: "OCR",
  protect: "Protect",
  split: "Split",
};

export const categoryColors: Record<ToolCategory, string> = {
  watermark: "bg-rose-500",
  convert: "bg-blue-500",
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
