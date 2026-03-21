import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-slate-50/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-500 flex items-center justify-center">
              <span className="text-white font-bold text-base leading-none">
                1
              </span>
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              1App
            </span>
          </div>

          {/* Privacy message */}
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-emerald-500"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>Your files never leave your device</span>
            </div>
            <span className="text-slate-300">|</span>
            <span>No sign-up required</span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link
              href="/"
              className="hover:text-slate-900 transition-colors"
            >
              All Tools
            </Link>
            <a
              href="https://github.com/Scyrptoeth/no-name-app"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-900 transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200/60 text-center text-xs text-slate-400">
          &copy; {new Date().getFullYear()} 1App. All processing is done
          locally in your browser.
        </div>
      </div>
    </footer>
  );
}
