interface HowItWorksStep {
  step: string;
  title: string;
  desc: string;
}

interface HowItWorksProps {
  steps: HowItWorksStep[];
}

export function HowItWorks({ steps }: HowItWorksProps) {
  const gridCols =
    steps.length === 5
      ? "sm:grid-cols-5"
      : steps.length === 4
        ? "sm:grid-cols-4"
        : "sm:grid-cols-3";

  return (
    <div className="mb-10">
      <h2 className="text-lg font-semibold text-slate-900 mb-6">
        How it works
      </h2>
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
  );
}
