const steps = ["Add app", "Save URLs", "Receive events"];

/** `current` is the active step index; steps.length means everything is done. */
export function WizardSteps({ current }: { current: number }) {
  const done = current >= steps.length;
  return (
    <ol className="my-7 grid grid-cols-3 gap-2" aria-label={done ? "Setup complete" : "Setup progress"}>
      {steps.map((label, i) => (
        <li key={label} aria-current={i === current ? "step" : undefined} className="min-w-0">
          <div className={`h-1 rounded-full ${i <= current ? "bg-accent" : "bg-border"}`} />
          <p className={`mt-2 truncate text-xs ${i === current ? "font-medium text-fg" : i < current ? "text-accent-text" : "text-muted"}`}>
            {i < current ? <span aria-label="done">✓ </span> : <span className="tnum">{i + 1}. </span>}
            {label}
          </p>
        </li>
      ))}
    </ol>
  );
}
