import type { ScreenerFrame } from "../types/messages";

export type PayloadSectionName = keyof ScreenerFrame & string;

export interface PayloadSuppressionMetrics {
  fullFrameSizeBytes: number;
  fullFrameSizeKb: number;
  suppressedFrameSizeBytes: number;
  suppressedFrameSizeKb: number;
  savedBytes: number;
  savedKb: number;
  suppressionRatio: number;
}

export interface PayloadSuppressionResult {
  frame: Partial<ScreenerFrame> & Pick<ScreenerFrame, "type" | "generatedAt">;
  metrics: PayloadSuppressionMetrics;
}
