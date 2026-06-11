import type { ReactNode } from "react";
import type { VoiceProfilePreset } from "@/lib/voice-profiles";

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs text-slate-200">{value}</div>
    </div>
  );
}

export function ExplainList({
  title,
  items,
  empty,
  tone
}: {
  title: string;
  items: string[];
  empty: string;
  tone: "negative" | "caution" | "neutral";
}) {
  const toneClass =
    tone === "negative"
      ? "border-negative/25 bg-negative/10 text-negative"
      : tone === "caution"
        ? "border-caution/25 bg-caution/10 text-caution"
        : "border-white/10 bg-white/5 text-slate-400";

  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-2 space-y-1.5">
        {items.length > 0 ? (
          items.slice(0, 4).map((item) => (
            <div
              key={item}
              className={`rounded border px-2 py-1 text-[11px] leading-4 ${toneClass}`}
              title={item}
            >
              {item}
            </div>
          ))
        ) : (
          <div className="text-[11px] leading-4 text-slate-500">{empty}</div>
        )}
      </div>
    </div>
  );
}

export function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right text-slate-200">{value}</span>
    </div>
  );
}

export function ToggleRow({
  label,
  detail,
  checked,
  onChange
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-3">
      <div>
        <div className="text-sm font-medium text-slate-100">{label}</div>
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-black/20"
      />
    </label>
  );
}

export function VoiceProfileChip({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] transition ${
        active
          ? "border-accent/50 bg-accent/15 text-white"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-accent/40 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

export function VoiceProfileCard({
  profile,
  active,
  onClick
}: {
  profile: VoiceProfilePreset;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-3 text-left transition ${
        active
          ? "border-accent/50 bg-accent/10 text-white"
          : "border-white/10 bg-white/5 text-slate-200 hover:border-accent/35 hover:bg-accent/5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{profile.label}</div>
        <div
          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
            active ? "bg-white/10 text-white" : "bg-black/20 text-slate-400"
          }`}
        >
          {active ? "active" : profile.badgeLabel}
        </div>
      </div>
      <div className="mt-1 text-xs text-slate-500">{profile.detail}</div>
    </button>
  );
}

export function PanelToggleButton({
  collapsed,
  onClick
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={!collapsed}
      className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300 transition hover:border-accent/40 hover:text-white"
    >
      {collapsed ? "Show" : "Hide"}
    </button>
  );
}

export function HeaderCell({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-3 text-left font-medium">{children}</th>;
}

export function Cell({
  children,
  className,
  colSpan
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-3 text-slate-200 ${className ?? ""}`}>
      {children}
    </td>
  );
}
