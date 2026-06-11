import type { ReactNode } from "react";

type EmptyStateTone = "neutral" | "caution" | "negative";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: EmptyStateTone;
  className?: string;
}

const toneClasses: Record<EmptyStateTone, string> = {
  neutral: "border-white/10 bg-black/20 text-slate-400",
  caution: "border-caution/25 bg-caution/10 text-caution",
  negative: "border-negative/30 bg-negative/10 text-negative"
};

const descriptionClasses: Record<EmptyStateTone, string> = {
  neutral: "text-slate-500",
  caution: "text-caution/80",
  negative: "text-slate-400"
};

export function EmptyState({
  title,
  description,
  action,
  tone = "neutral",
  className = ""
}: EmptyStateProps) {
  return (
    <div className={`rounded-lg border p-6 text-center ${toneClasses[tone]} ${className}`}>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className={`mt-2 text-xs ${descriptionClasses[tone]}`}>{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
