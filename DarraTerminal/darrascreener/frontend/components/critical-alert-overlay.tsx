"use client";

import { compactUsd, formatClock, formatPercent } from "@/lib/format";
import type { ScreenerAlert } from "@/lib/types";

const formatPairLabel = (symbol: string): string =>
  symbol.trim().toUpperCase().replace(/(USDT|USDC|BUSD|FDUSD)$/i, " $1").trim();

export function CriticalAlertOverlay({
  alert,
  queuedCount,
  onClose,
  onOpenChart
}: {
  alert: ScreenerAlert;
  queuedCount: number;
  onClose: () => void;
  onOpenChart: (symbol: string) => void;
}) {
  const quoteVolume24h = alert.quoteVolume24h ?? alert.notionalUsd;
  const averageVolume = alert.averageDailyQuoteVolume;
  const volumeChangePct = alert.volumeChangePct;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="critical-alert-title"
      className="critical-alert-overlay fixed inset-0 z-[140] flex items-center justify-center px-4 py-6"
    >
      <div className="absolute inset-0 bg-black/82 backdrop-blur-md" />
      <div className="critical-alert-card relative z-10 w-full max-w-5xl overflow-hidden rounded-[2rem] border border-red-300/30 bg-[#120608] p-5 shadow-[0_0_120px_rgba(248,113,113,0.28)] sm:p-8">
        <div className="critical-alert-card__glow" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.34em] text-red-200">
                Critical Alert
              </div>
              <h2
                id="critical-alert-title"
                className="mt-3 break-words text-6xl font-black uppercase leading-none tracking-[-0.08em] text-white sm:text-8xl lg:text-9xl"
              >
                {formatPairLabel(alert.symbol)}
              </h2>
            </div>
            <div className="rounded-full border border-red-200/25 bg-red-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-red-100">
              {queuedCount > 0 ? `${queuedCount} в очереди` : "ожившая монета"}
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-base text-red-50/78 sm:text-lg">
            Монета была классифицирована как мертвая по заданным критериям и резко вышла на
            высокий 24-часовой объем.
          </p>

          <div className="mt-7 grid gap-3 md:grid-cols-4">
            <CriticalMetric label="24h volume" value={compactUsd(quoteVolume24h)} />
            <CriticalMetric
              label="30d avg"
              value={averageVolume !== null && averageVolume !== undefined ? compactUsd(averageVolume) : "--"}
            />
            <CriticalMetric
              label="volume change"
              value={volumeChangePct !== null && volumeChangePct !== undefined ? formatPercent(volumeChangePct, 2) : "--"}
              hot
            />
            <CriticalMetric label="detected" value={formatClock(alert.createdAt)} />
          </div>

          <div className="mt-7 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-red-50/70">
            {alert.reason}
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onOpenChart(alert.symbol)}
              className="rounded-full border border-red-200/40 bg-red-100 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-[#210508] transition hover:bg-white"
            >
              Открыть график
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-bold uppercase tracking-[0.18em] text-white transition hover:border-white/35 hover:bg-white/20"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CriticalMetric({
  label,
  value,
  hot = false
}: {
  label: string;
  value: string;
  hot?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-red-100/55">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-black ${hot ? "text-red-100" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}
