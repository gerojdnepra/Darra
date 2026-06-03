import type { CSSProperties } from "react";
import { normalizeSignalBillboardPreferences } from "@/lib/signal-billboard";
import type {
  Bias,
  InterfaceLanguage,
  ScreenerAlert,
  SignalBillboardPreferences
} from "@/lib/types";

const splitSignalPair = (symbol: string): { base: string; quote: string | null } => {
  const normalized = symbol.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalized.match(/^(.*?)(USDT|USDC|BUSD|FDUSD)$/i);

  if (!match) {
    return {
      base: normalized || symbol.trim().toUpperCase(),
      quote: null
    };
  }

  return {
    base: match[1] || normalized,
    quote: match[2].toUpperCase()
  };
};

export function SignalBillboardOverlay({
  symbol,
  bias,
  severity: _severity,
  preferences,
  interfaceLanguage: _interfaceLanguage = "en",
  className = ""
}: {
  symbol: string;
  bias: Bias;
  severity: ScreenerAlert["severity"];
  preferences: SignalBillboardPreferences;
  interfaceLanguage?: InterfaceLanguage;
  className?: string;
}) {
  const normalizedPreferences = normalizeSignalBillboardPreferences(preferences);
  const overlayClassName = [
    "signal-billboard-overlay",
    bias === "SHORT" ? "signal-billboard-overlay--short" : "signal-billboard-overlay--long",
    className
  ]
    .filter(Boolean)
    .join(" ");
  const { base, quote } = splitSignalPair(symbol);
  const style = {
    "--signal-top-band-size": `${normalizedPreferences.topBandSize}%`,
    "--signal-bottom-band-size": `${normalizedPreferences.bottomBandSize}%`,
    "--signal-top-band-opacity": `${normalizedPreferences.topBandOpacity / 100}`,
    "--signal-bottom-band-opacity": `${normalizedPreferences.bottomBandOpacity / 100}`
  } as CSSProperties;

  return (
    <div aria-hidden="true" className={overlayClassName} style={style}>
      <div className="signal-billboard-band signal-billboard-band--top">
        <div className="signal-billboard-band__wash" />
        <div className="signal-billboard-band__content signal-billboard-band__content--top">
          <div className="signal-billboard__pair">
            <div className="signal-billboard__symbol">{base}</div>
            {quote ? <div className="signal-billboard__quote">{quote}</div> : null}
          </div>
          <div className="signal-billboard__direction-badge">{bias}</div>
        </div>
      </div>
    </div>
  );
}
