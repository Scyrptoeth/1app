"use client";

import { useState } from "react";

interface HowItWorksStep {
  step: string;
  title: string;
  desc: string;
}

interface HowItWorksProps {
  steps: HowItWorksStep[];
}

export function HowItWorks({ steps }: HowItWorksProps) {
  const [open, setOpen] = useState(false);

  const gridCols =
    steps.length === 5
      ? "sm:grid-cols-5"
      : steps.length === 4
        ? "sm:grid-cols-4"
        : "sm:grid-cols-3";

  return (
    <div className="mb-10">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-lg font-semibold text-slate-900 hover:text-accent-600 transition-colors"
      >
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        How It Works
      </button>
      <div
        className={`grid transition-all duration-300 ease-in-out ${open ? "grid-rows-[1fr] opacity-100 mt-6" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <div className={`grid ${gridCols} gap-6`}>
            {steps.map((item) => (
              <div
                key={item.step}
                className="flex flex-col items-center text-center"
              >
                <div className="w-10 h-10 rounded-full bg-accent-50 flex items-center justify-center mb-3">
                  <span className="text-sm font-bold text-accent-600">
                    {item.step}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 mb-1">
                  {item.title}
                </h3>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
