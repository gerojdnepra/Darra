"use client";

import { useState, useMemo } from "react";
import type { SignalReplayTimelineEntry, SignalOutcomeRecord } from "@/lib/types";

interface ReplayTimelineChartProps {
  timeline: SignalReplayTimelineEntry[];
}

interface TimelinePoint {
  label: string;
  x: number;
  y: number;
  outcome: SignalOutcomeRecord | null;
  timestamp: number | null;
  horizonSec: number | null;
}

export function ReplayTimelineChart({ timeline }: ReplayTimelineChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<TimelinePoint | null>(null);

  const points = useMemo(() => {
    if (!timeline || timeline.length === 0) return [];

    const width = 600;
    const height = 150;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Calculate price range for Y-axis
    const allPrices = timeline
      .map((entry) => entry.outcome?.startPrice ?? entry.outcome?.endPrice ?? null)
      .filter((p): p is number => p !== null);

    if (allPrices.length === 0) return [];

    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const priceRange = maxPrice - minPrice || 1;

    return timeline.map((entry, index) => {
      const x = padding.left + (index / (timeline.length - 1)) * chartWidth;
      
      const price = entry.outcome?.endPrice ?? entry.outcome?.startPrice ?? null;
      const y = price !== null
        ? padding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight
        : padding.top + chartHeight / 2;

      return {
        label: entry.label,
        x,
        y,
        outcome: entry.outcome,
        timestamp: entry.timestamp,
        horizonSec: entry.horizonSec,
      };
    });
  }, [timeline]);

  if (!timeline || timeline.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-white/10 bg-black/20 text-xs text-slate-500">
        No timeline data available
      </div>
    );
  }

  const width = 600;
  const height = 150;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };

  return (
    <div className="w-full">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        Outcome Timeline
      </div>
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          className="rounded-md border border-white/10 bg-black/20"
        >
          {/* Y-axis labels */}
          {(() => {
            const firstPoint = points[0];
            if (firstPoint?.outcome?.startPrice != null) {
              return (
                <text
                  x={padding.left - 10}
                  y={padding.top + 10}
                  textAnchor="end"
                  className="fill-slate-500 text-[10px]"
                >
                  {firstPoint.outcome.startPrice.toFixed(2)}
                </text>
              );
            }
            return null;
          })()}
          {(() => {
            const lastPoint = points[points.length - 1];
            if (lastPoint?.outcome?.endPrice != null) {
              return (
                <text
                  x={padding.left - 10}
                  y={lastPoint.y + 3}
                  textAnchor="end"
                  className="fill-slate-500 text-[10px]"
                >
                  {lastPoint.outcome.endPrice.toFixed(2)}
                </text>
              );
            }
            return null;
          })()}

          {/* Horizontal line at middle */}
          <line
            x1={padding.left}
            y1={padding.top + (height - padding.top - padding.bottom) / 2}
            x2={width - padding.right}
            y2={padding.top + (height - padding.top - padding.bottom) / 2}
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />

          {/* Timeline line */}
          {points.length > 1 && (
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="rgba(56, 189, 248, 0.6)"
              strokeWidth={2}
            />
          )}

          {/* Timeline points */}
          {points.map((point, index) => (
            <g key={point.label}>
              <circle
                cx={point.x}
                cy={point.y}
                r={6}
                fill="rgba(56, 189, 248, 0.2)"
                stroke="rgba(56, 189, 248, 0.8)"
                strokeWidth={2}
                onMouseEnter={() => setHoveredPoint(point)}
                onMouseLeave={() => setHoveredPoint(null)}
                className="cursor-pointer"
              />
              <text
                x={point.x}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-400 text-[10px]"
              >
                {point.label}
              </text>
            </g>
          ))}

          {/* Tooltip */}
          {hoveredPoint && (
            <g>
              <rect
                x={hoveredPoint.x + 10}
                y={hoveredPoint.y - 40}
                width={140}
                height={70}
                fill="rgba(0, 0, 0, 0.9)"
                stroke="rgba(255, 255, 255, 0.2)"
                strokeWidth={1}
                rx={4}
              />
              <text
                x={hoveredPoint.x + 20}
                y={hoveredPoint.y - 22}
                className="fill-white text-[11px] font-semibold"
              >
                {hoveredPoint.label}
              </text>
              {hoveredPoint.outcome && (
                <>
                  <text
                    x={hoveredPoint.x + 20}
                    y={hoveredPoint.y - 8}
                    className="fill-slate-300 text-[10px]"
                  >
                    Price: {hoveredPoint.outcome.endPrice?.toFixed(2) ?? "N/A"}
                  </text>
                  <text
                    x={hoveredPoint.x + 20}
                    y={hoveredPoint.y + 6}
                    className="fill-emerald-400 text-[10px]"
                  >
                    Max Fav: {hoveredPoint.outcome.maxFavorablePct?.toFixed(2) ?? "N/A"}%
                  </text>
                  <text
                    x={hoveredPoint.x + 20}
                    y={hoveredPoint.y + 20}
                    className="fill-rose-400 text-[10px]"
                  >
                    Max Adv: {hoveredPoint.outcome.maxAdversePct?.toFixed(2) ?? "N/A"}%
                  </text>
                </>
              )}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
