"use client";

import { useEffect, useState } from "react";
import {
  getDesktopBridge,
  type DesktopManagedWindowKey,
  type DesktopShellState,
  type DesktopWindowGroup,
  type DesktopWindowGroupColor
} from "@/lib/desktop-shell";

const windowGroupColorClasses: Record<
  DesktopWindowGroupColor,
  { badge: string; dot: string; text: string }
> = {
  blue: {
    badge: "border-sky-400/30 bg-sky-500/10",
    dot: "bg-sky-300",
    text: "text-sky-100"
  },
  green: {
    badge: "border-emerald-400/30 bg-emerald-500/10",
    dot: "bg-emerald-300",
    text: "text-emerald-100"
  },
  amber: {
    badge: "border-amber-400/30 bg-amber-500/10",
    dot: "bg-amber-300",
    text: "text-amber-100"
  },
  rose: {
    badge: "border-rose-400/30 bg-rose-500/10",
    dot: "bg-rose-300",
    text: "text-rose-100"
  },
  violet: {
    badge: "border-violet-400/30 bg-violet-500/10",
    dot: "bg-violet-300",
    text: "text-violet-100"
  },
  slate: {
    badge: "border-slate-400/30 bg-slate-500/10",
    dot: "bg-slate-300",
    text: "text-slate-100"
  }
};

const resolveWindowGroup = (
  snapshot: DesktopShellState,
  windowKey: DesktopManagedWindowKey
): DesktopWindowGroup | null => {
  const groupId = snapshot.windowGroups?.assignments?.[windowKey] ?? null;
  return groupId ? snapshot.windowGroups?.groups?.[groupId] ?? null : null;
};

export function DesktopWindowGroupBadge({
  group,
  compact = false,
  className = ""
}: {
  group: DesktopWindowGroup | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  if (!group) {
    return null;
  }

  const colors = windowGroupColorClasses[group.color] ?? windowGroupColorClasses.blue;

  return (
    <div
      className={`inline-flex max-w-full items-center gap-2 rounded-full border ${colors.badge} px-3 py-1 text-xs shadow-lg shadow-black/20 ${colors.text} ${className}`}
      title="Window Group metadata only"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${colors.dot}`} />
      <span className="min-w-0 truncate font-semibold">{group.label}</span>
      {!compact ? (
        <>
          <span className="text-white/25">|</span>
          <span className="shrink-0 font-mono text-[11px] uppercase">
            {group.symbol ?? "no-symbol"}
          </span>
          <span className="text-white/25">|</span>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.16em]">
            {group.contextMode}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function DesktopWindowGroupBadgeOverlay({
  windowKey
}: {
  windowKey: DesktopManagedWindowKey;
}) {
  const [group, setGroup] = useState<DesktopWindowGroup | null>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();

    if (!bridge) {
      setGroup(null);
      return;
    }

    let cancelled = false;
    const syncGroup = (snapshot: DesktopShellState) => {
      if (!cancelled) {
        setGroup(resolveWindowGroup(snapshot, windowKey));
      }
    };

    bridge.getState().then(syncGroup).catch(() => {
      if (!cancelled) {
        setGroup(null);
      }
    });

    const unsubscribe = bridge.onStateChanged(syncGroup);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [windowKey]);

  if (!group) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[80] flex max-w-[min(420px,calc(100vw-2rem))] justify-end">
      <DesktopWindowGroupBadge group={group} />
    </div>
  );
}
