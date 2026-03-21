import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "1App — All-in-One File Processing",
  description:
    "Free online file processing tools. Remove watermarks, convert, merge, compress, and more. All processing happens in your browser — your files never leave your device.",
  keywords: [
    "file processing",
    "remove watermark",
    "pdf tools",
    "image tools",
    "convert pdf",
    "merge pdf",
    "compress image",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
