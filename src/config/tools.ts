export interface Tool {
  id: string;
  name: string;
  description: string;
  href: string;
  category: 'watermark' | 'convert';
  icon: string;
}

export const tools: Tool[] = [
  // Watermark Removal
  {
    id: 'pdf-watermark-remove',
    name: 'PDF Watermark Remover',
    description: 'Remove watermarks from PDF documents while preserving the original content and formatting.',
    href: '/tools/pdf-watermark-remove',
    category: 'watermark',
    icon: '📄',
  },
  {
    id: 'image-watermark-remove',
    name: 'Image Watermark Remover',
    description: 'Remove colored watermarks from scanned documents and images using advanced color restoration.',
    href: '/tools/image-watermark-remove',
    category: 'watermark',
    icon: '🖼️',
  },

  // Convert
  {
    id: 'image-to-excel',
    name: 'Image to Excel',
    description: 'Convert images of tables and financial documents to editable Excel spreadsheets using OCR.',
    href: '/tools/image-to-excel',
    category: 'convert',
    icon: '📊',
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    description: 'Convert PDF documents containing tables and financial data to editable Excel spreadsheets.',
    href: '/tools/pdf-to-excel',
    category: 'convert',
    icon: '📑',
  },
];

export const categories = [
  {
    id: 'watermark',
    name: 'Watermark Removal',
    description: 'Remove watermarks from your documents and images',
  },
  {
    id: 'convert',
    name: 'Convert',
    description: 'Convert documents between different formats',
  },
] as const;
