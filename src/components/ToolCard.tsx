"use client";

import Link from "next/link";
import { ToolConfig, categoryColors } from "@/config/tools";
import * as LucideIcons from "lucide-react";

interface ToolCardProps {
  tool: ToolConfig;
  index: number;
}

export default function ToolCard({ tool, index }: ToolCardProps) {
  // Dynamically get the icon component
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const icons = LucideIcons as any;
  const IconComponent = icons[tool.icon] || LucideIcons.FileQuestion;

  const colorBg = categoryColors[tool.category] || "bg-slate-500";

  return (
    <Link
      href={tool.isAvailable ? tool.route : "#"}
      className={`animate-fade-up group relative flex flex-col items-center text-center p-6 rounded-2xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-lg hover:shadow-slate-100/80 transition-all duration-300 ${
        !tool.isAvailable ? "opacity-60 cursor-not-allowed" : ""
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={(e) => {
        if (!tool.isAvailable) e.preventDefault();
      }}
    >
      {/* Icon */}
      <div
        className={`w-14 h-14 rounded-2xl ${colorBg} flex items-center justify-center mb-4 shadow-md group-hover:scale-110 group-hover:shadow-lg transition-all duration-300`}
      >
        <IconComponent size={26} className="text-white" />
      </div>

      {/* Name */}
      <h3 className="text-sm font-semibold text-slate-900 mb-1.5 group-hover:text-accent-600 transition-colors">
        {tool.name}
      </h3>

      {/* Description */}
      <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
        {tool.description}
      </p>

      {/* Formats */}
      <div className="flex flex-wrap items-center justify-center gap-1 mt-3">
        {tool.inputFormats.map((fmt) => (
          <span
            key={fmt}
            className="px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-50 rounded"
          >
            {fmt}
          </span>
        ))}
      </div>

      {/* Coming soon badge */}
      {!tool.isAvailable && (
        <div className="absolute top-3 right-3 px-2 py-0.5 bg-slate-100 rounded-full text-[10px] font-medium text-slate-500">
          Coming Soon
        </div>
      )}
    </Link>
  );
}
