"use client";

import { useState } from "react";
import { getModuleHelp, type ModuleHelpId } from "@/lib/module-help";

interface ModuleInfoButtonProps {
  moduleId: ModuleHelpId | string;
}

export function ModuleInfoButton({ moduleId }: ModuleInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const help = getModuleHelp(moduleId);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`About ${help.title}`}
        title={`About ${help.title}`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-slate-300 transition hover:border-accent/40 hover:text-accent"
      >
        i
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-50 w-[min(320px,calc(100vw-32px))] rounded-lg border border-white/10 bg-[#101720] p-3 text-left shadow-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
                {help.title}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">module guide</div>
            </div>
            <button
              type="button"
              aria-label="Close module guide"
              onClick={() => setOpen(false)}
              className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-400 transition hover:text-slate-100"
            >
              Close
            </button>
          </div>
          <div className="mt-3 space-y-3 text-xs leading-5 text-slate-300">
            <HelpLine label="Shows" value={help.shows} />
            <HelpLine label="Why" value={help.why} />
            <HelpLine label="Read" value={help.interpret} />
            <HelpLine label="Ignore" value={help.ignore} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HelpLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}
