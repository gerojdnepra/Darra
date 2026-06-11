import type { ScreenerFrame } from "../types/messages";

export type PayloadSectionName = keyof ScreenerFrame & string;

export interface PayloadSuppressionMetrics {
  fullFrameSizeBytes: number;
  fullFrameSizeKb: number;
  projectedFrameSizeBytes: number;
  projectedFrameSizeKb: number;
  suppressedFrameSizeBytes: number;
  suppressedFrameSizeKb: number;
  savedBytes: number;
  savedKb: number;
  suppressionRatio: number;
  requestedSections: string[];
  skippedSections: string[];
  projectionMode: "default" | "visible_sections";
}

export interface PayloadSuppressionResult {
  frame: Partial<ScreenerFrame> & Pick<ScreenerFrame, "type" | "generatedAt">;
  metrics: PayloadSuppressionMetrics;
}
