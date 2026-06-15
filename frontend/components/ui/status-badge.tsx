import type { ReactNode } from "react";
import { getBiasVisual, getDecisionVisual } from "@/lib/trading-visuals";

export type StatusBadgeStatus = "OK" | "CHECK" | "BLOCKED" | "WAITING" | "UNKNOWN";
export type StatusBadgeTone = "positive" | "caution" | "negative" | "neutral";
export type StatusBadgeSize = "sm" | "md";

interface StatusBadgeProps {
  status: StatusBadgeStatus;
  children?: ReactNode;
  tone?: StatusBadgeTone;
  size?: StatusBadgeSize;
  className?: string;
}

const statusTone: Record<StatusBadgeStatus, StatusBadgeTone> = {
  OK: "positive",
  CHECK: "caution",
  BLOCKED: "negative",
  WAITING: "neutral",
  UNKNOWN: "neutral"
};

const toneClasses: Record<StatusBadgeTone, string> = {
  positive: getDecisionVisual("OK").badgeClass,
  caution: getDecisionVisual("WAIT").badgeClass,
  negative: getDecisionVisual("BLOCKED").badgeClass,
  neutral: getBiasVisual("NEUTRAL").badgeClass
};

const sizeClasses: Record<StatusBadgeSize, string> = {
  sm: "px-2 py-0.5 text-[10px] tracking-[0.14em]",
  md: "px-2.5 py-1 text-[10px] tracking-[0.16em]"
};

export function StatusBadge({
  status,
  children,
  tone,
  size = "md",
  className = ""
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-full border font-semibold uppercase ${sizeClasses[size]} ${
        toneClasses[tone ?? statusTone[status]]
      } ${className}`}
    >
      {children ?? status}
    </span>
  );
}
