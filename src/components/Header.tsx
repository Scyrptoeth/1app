"use client";

import Link from "next/link";
import { useState } from "react";
import { tools, categoryLabels, getAllCategories } from "@/config/tools";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const categories = getAllCategories();

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
            {categories.map((cat) => (
              <div key={cat} className="relative group">
                <button className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors">
                  {categoryLabels[cat]}
                </button>
                {/* Dropdown */}
                <div className="absolute top-full left-0 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-white rounded-xl shadow-xl shadow-slate-200/50 border border-slate-100 p-2 min-w-[240px]">
                    {tools
                      .filter((t) => t.category === cat)
                      .map((tool) => (
                        <Link
                          key={tool.id}
                          href={tool.route}
                          className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                          <div className="mt-0.5 w-2 h-2 rounded-full bg-accent-500 shrink-0" />
                          <div>
                            <div className="text-sm font-medium text-slate-900">
                              {tool.name}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                              {tool.description}
                            </div>
                          </div>
                        </Link>
                      ))}
                  </div>
                </div>
              </div>
            ))}
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
          <div className="px-4 py-4 space-y-1">
            {tools.map((tool) => (
              <Link
                key={tool.id}
                href={tool.route}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="w-2 h-2 rounded-full bg-accent-500" />
                <span className="text-sm font-medium text-slate-700">
                  {tool.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
