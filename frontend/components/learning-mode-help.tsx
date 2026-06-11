"use client";

import { getModuleHelp, type ModuleHelpId } from "@/lib/module-help";

interface LearningModeHelpProps {
  moduleId: ModuleHelpId;
  learningMode: boolean;
}

export function LearningModeHelp({ moduleId, learningMode }: LearningModeHelpProps) {
  if (!learningMode) {
    return null;
  }

  const help = getModuleHelp(moduleId);

  return (
    <div className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
        Learning Mode
      </div>
      <div className="space-y-2 text-xs">
        <div>
          <span className="font-semibold text-slate-300">Shows:</span>{" "}
          <span className="text-slate-400">{help.shows}</span>
        </div>
        <div>
          <span className="font-semibold text-slate-300">Why:</span>{" "}
          <span className="text-slate-400">{help.why}</span>
        </div>
        <div>
          <span className="font-semibold text-slate-300">Interpret:</span>{" "}
          <span className="text-slate-400">{help.interpret}</span>
        </div>
        <div>
          <span className="font-semibold text-slate-300">Ignore:</span>{" "}
          <span className="text-slate-400">{help.ignore}</span>
        </div>
      </div>
    </div>
  );
}
