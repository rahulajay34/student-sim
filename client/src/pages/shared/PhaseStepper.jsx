// Horizontal 5-step indicator for the counselling call phases.
// Purely presentational: highlights completed + current phases in brand color.

const STEPS = [
  { n: 1, label: "Opening" },
  { n: 2, label: "Discovery" },
  { n: 3, label: "Presentation" },
  { n: 4, label: "Objections" },
  { n: 5, label: "Close" },
];

export default function PhaseStepper({ current = 1 }) {
  return (
    <div className="flex w-full items-center">
      {STEPS.map((step, i) => {
        const done = step.n < current;
        const isCurrent = step.n === current;
        const reached = step.n <= current;

        const circle = isCurrent
          ? "bg-brand-600 text-white"
          : done
          ? "bg-brand-100 text-brand-700"
          : "bg-slate-100 text-muted";

        // Connector belongs to the gap after this step; it is "filled"
        // when the next step has already been reached.
        const nextReached = STEPS[i + 1] && STEPS[i + 1].n <= current;
        const connector = nextReached ? "bg-brand-200" : "bg-slate-200";

        return (
          <div key={step.n} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${circle}`}
              >
                {step.n}
              </span>
              <span
                className={`hidden whitespace-nowrap text-xs font-medium transition-colors sm:block ${
                  reached ? "text-ink" : "text-muted"
                }`}
              >
                {step.label}
              </span>
            </div>

            {STEPS[i + 1] && (
              <span className={`mx-2 h-px flex-1 rounded-full ${connector}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
