"use client";

import type { ReactNode } from "react";
import { ModuleInfoButton } from "@/components/module-info-button";
import type { ModuleHelpId } from "@/lib/module-help";

interface PanelHeaderProps {
  title: string;
  subtitle?: ReactNode;
  moduleId?: ModuleHelpId | string;
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({
  title,
  subtitle,
  moduleId,
  actions,
  className = ""
}: PanelHeaderProps) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
          {title}
        </h2>
        {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {actions || moduleId ? (
        <div className="flex items-center gap-2">
          {actions}
          {moduleId ? <ModuleInfoButton moduleId={moduleId} /> : null}
        </div>
      ) : null}
    </div>
  );
}
