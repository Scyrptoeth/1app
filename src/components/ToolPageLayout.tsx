"use client";

import Link from "next/link";
import { ToolConfig, categoryColors } from "@/config/tools";
import * as LucideIcons from "lucide-react";

interface ToolPageLayoutProps {
  tool: ToolConfig;
  children: React.ReactNode;
  privacyMessage?: string;
  contentMaxWidth?: string;
}

export default function ToolPageLayout({ tool, children, privacyMessage, contentMaxWidth }: ToolPageLayoutProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const icons = LucideIcons as any;
  const IconComponent = icons[tool.icon] || LucideIcons.FileQuestion;

  const colorBg = categoryColors[tool.category] || "bg-slate-500";

  return (
    <div className="animate-fade-in">
      {/* Tool Header */}
      <section className="bg-slate-50/50 border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-6">
            <Link
              href="/"
              className="hover:text-slate-600 transition-colors"
            >
              All Tools
            </Link>
            <span>/</span>
            <span className="text-slate-600">{tool.name}</span>
          </div>

          <div className="flex items-start gap-4">
            <div
              className={`w-12 h-12 rounded-xl ${colorBg} flex items-center justify-center shadow-md shrink-0`}
            >
              <IconComponent size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
                {tool.name}
              </h1>
              <p className="mt-1 text-sm sm:text-base text-slate-500">
                {tool.description}
              </p>
            </div>
          </div>

          {/* Privacy reminder */}
          <div className="mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-full">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-emerald-500"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
            <span className="text-xs font-medium text-emerald-700">
              {privacyMessage || "Files are processed locally — nothing is uploaded"}
            </span>
          </div>
        </div>
      </section>

      {/* Tool Content */}
      <section className={`${contentMaxWidth || "max-w-4xl"} mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16`}>
        {children}
      </section>
    </div>
  );
}
