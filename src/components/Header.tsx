"use client";

import Link from "next/link";
import { useState } from "react";
import { getToolById, SECTIONS, type ToolConfig } from "@/config/tools";

/**
 * Sections that should be merged into a single nav item with nested submenu.
 * Key = displayed nav label. Value = { main, utilities } section labels from SECTIONS.
 */
const MERGED_NAV: Record<string, { main: string; utilities: string }> = {
  Image: { main: "Image", utilities: "Image Utilities" },
  PDF: { main: "PDF", utilities: "PDF Utilities" },
};

/** Labels that are consumed by a merged nav and should be skipped in top-level iteration. */
const MERGED_CHILDREN = new Set(
  Object.values(MERGED_NAV).flatMap((v) => [v.main, v.utilities])
);

function resolveTools(toolIds: string[]): ToolConfig[] {
  return toolIds
    .map((id) => getToolById(id))
    .filter(Boolean) as ToolConfig[];
}

function dedup(tools: ToolConfig[]): ToolConfig[] {
  return tools.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);
}

function ToolLink({
  tool,
  onClick,
}: {
  tool: ToolConfig;
  onClick?: () => void;
}) {
  return (
    <Link
      href={tool.route}
      onClick={onClick}
      className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
    >
      <div className="mt-0.5 w-2 h-2 rounded-full bg-accent-500 shrink-0" />
      <div>
        <div className="text-sm font-medium text-slate-900">{tool.name}</div>
        <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
          {tool.description}
        </div>
      </div>
    </Link>
  );
}

/** Chevron-right icon for submenu indicators. */
function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-slate-400"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  // Build nav items: merged sections become a single entry, others pass through
  const navItems: {
    label: string;
    type: "simple" | "merged";
    tools?: ToolConfig[];
    subs?: { label: string; tools: ToolConfig[] }[];
  }[] = [];

  const processed = new Set<string>();

  for (const section of SECTIONS) {
    if (processed.has(section.label)) continue;

    // Check if this section is part of a merged group
    const mergedEntry = Object.entries(MERGED_NAV).find(
      ([, v]) => v.main === section.label || v.utilities === section.label
    );

    if (mergedEntry) {
      const [mergedLabel, { main, utilities }] = mergedEntry;
      if (processed.has(mergedLabel)) continue;

      const mainSection = SECTIONS.find((s) => s.label === main);
      const utilSection = SECTIONS.find((s) => s.label === utilities);

      navItems.push({
        label: mergedLabel,
        type: "merged",
        subs: [
          {
            label: "Main",
            tools: dedup(resolveTools(mainSection?.toolIds ?? [])),
          },
          {
            label: "Utilities",
            tools: dedup(resolveTools(utilSection?.toolIds ?? [])),
          },
        ],
      });
      processed.add(mergedLabel);
      processed.add(main);
      processed.add(utilities);
    } else if (!MERGED_CHILDREN.has(section.label)) {
      navItems.push({
        label: section.label,
        type: "simple",
        tools: dedup(resolveTools(section.toolIds)),
      });
      processed.add(section.label);
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-accent-500 flex items-center justify-center shadow-md shadow-accent-500/25 group-hover:shadow-lg group-hover:shadow-accent-500/30 transition-shadow">
              <span className="text-white font-bold text-lg leading-none">
                1
              </span>
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              1App
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) =>
              item.type === "simple" ? (
                /* Simple dropdown (unchanged) */
                <div key={item.label} className="relative group">
                  <button className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors">
                    {item.label}
                  </button>
                  <div className="absolute top-full left-0 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                    <div className="bg-white rounded-xl shadow-xl shadow-slate-200/50 border border-slate-100 p-2 min-w-[240px]">
                      {item.tools?.map((tool) => (
                        <ToolLink key={tool.id} tool={tool} />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Merged dropdown with nested flyout */
                <div key={item.label} className="relative group/parent">
                  <button className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors">
                    {item.label}
                  </button>
                  {/* First-level dropdown: subcategories */}
                  <div className="absolute top-full left-0 pt-2 opacity-0 invisible group-hover/parent:opacity-100 group-hover/parent:visible transition-all duration-200">
                    <div className="bg-white rounded-xl shadow-xl shadow-slate-200/50 border border-slate-100 p-2 min-w-[180px]">
                      {item.subs?.map((sub) => (
                        <div key={sub.label} className="relative group/sub">
                          <div className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors cursor-default">
                            <span className="text-sm font-medium text-slate-700">
                              {sub.label}
                            </span>
                            <ChevronRight />
                          </div>
                          {/* Second-level flyout: tools */}
                          <div className="absolute left-full top-0 pl-2 opacity-0 invisible group-hover/sub:opacity-100 group-hover/sub:visible transition-all duration-200">
                            <div className="bg-white rounded-xl shadow-xl shadow-slate-200/50 border border-slate-100 p-2 min-w-[260px]">
                              {sub.tools.map((tool) => (
                                <ToolLink key={tool.id} tool={tool} />
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            )}
          </nav>

          {/* Privacy badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-emerald-700">
              100% Client-Side
            </span>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-slate-50 transition-colors"
            aria-label="Toggle menu"
          >
            <svg
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {menuOpen ? (
                <>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </>
              ) : (
                <>
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-slate-100 bg-white animate-fade-in">
          <div className="px-4 py-4 space-y-4">
            {navItems.map((item) =>
              item.type === "simple" ? (
                <div key={item.label}>
                  <p className="px-3 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    {item.label}
                  </p>
                  {item.tools?.map((tool) => (
                    <ToolLink
                      key={tool.id}
                      tool={tool}
                      onClick={() => setMenuOpen(false)}
                    />
                  ))}
                </div>
              ) : (
                <div key={item.label}>
                  {item.subs?.map((sub) => (
                    <div key={sub.label} className="mb-3 last:mb-0">
                      <p className="px-3 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        {item.label} — {sub.label}
                      </p>
                      {sub.tools.map((tool) => (
                        <ToolLink
                          key={tool.id}
                          tool={tool}
                          onClick={() => setMenuOpen(false)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </header>
  );
}
