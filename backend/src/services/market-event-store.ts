import fs from "node:fs";
import path from "node:path";
import type {
  RevivingCoinAlertSettings,
  ScreenerAlert,
  ScreenerAlertKind
} from "../types/messages";

export interface RevivingCoinEventRecord {
  id: string;
  alertId: string;
  symbol: string;
  baseAsset: string;
  quoteVolume24h: number;
  averageDailyQuoteVolume: number | null;
  volumeChangePct: number | null;
  liquidityLookbackDays: number;
  noSignalLookbackDays: number;
  detectedAt: number;
  criteria: {
    lowAverageVolume: boolean;
    noRecentSignals: boolean;
    requireAllDeadCriteria: boolean;
  };
  settingsSnapshot: RevivingCoinAlertSettings;
}

interface StoredSignalEvent {
  type: "signal";
  id: string;
  alertId: string;
  symbol: string;
  kind: ScreenerAlertKind | null;
  createdAt: number;
}

interface StoredRevivingCoinEvent extends RevivingCoinEventRecord {
  type: "reviving_coin";
}

type StoredMarketEvent = StoredSignalEvent | StoredRevivingCoinEvent;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export class MarketEventStore {
  private readonly signalIds = new Set<string>();
  private readonly lastSignalAtBySymbol = new Map<string, number>();
  private readonly lastRevivingAtBySymbol = new Map<string, number>();
  private readonly revivingEvents: RevivingCoinEventRecord[] = [];

  constructor(private readonly filePath: string) {
    this.loadFromDisk();
  }

  recordSignal(alert: ScreenerAlert): void {
    if (this.signalIds.has(alert.id)) {
      return;
    }

    const symbol = alert.symbol.trim().toUpperCase();
    if (!symbol || !Number.isFinite(alert.createdAt)) {
      return;
    }

    const event: StoredSignalEvent = {
      type: "signal",
      id: `signal:${alert.id}`,
      alertId: alert.id,
      symbol,
      kind: alert.kind ?? null,
      createdAt: alert.createdAt
    };

    this.signalIds.add(alert.id);
    this.lastSignalAtBySymbol.set(symbol, alert.createdAt);
    this.appendEvent(event);
  }

  recordRevivingCoinEvent(event: RevivingCoinEventRecord): void {
    const symbol = event.symbol.trim().toUpperCase();
    if (!symbol || !Number.isFinite(event.detectedAt)) {
      return;
    }

    this.revivingEvents.unshift(event);
    this.revivingEvents.splice(500);
    this.lastRevivingAtBySymbol.set(symbol, event.detectedAt);
    this.appendEvent({
      ...event,
      symbol,
      type: "reviving_coin"
    });
  }

  hasSignalSince(symbol: string, since: number): boolean {
    return (this.lastSignalAtBySymbol.get(symbol.trim().toUpperCase()) ?? 0) >= since;
  }

  hasRevivingEventSince(symbol: string, since: number): boolean {
    return (this.lastRevivingAtBySymbol.get(symbol.trim().toUpperCase()) ?? 0) >= since;
  }

  listRevivingCoinEvents(limit = 100): RevivingCoinEventRecord[] {
    return this.revivingEvents.slice(0, Math.max(0, limit));
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const source = fs.readFileSync(this.filePath, "utf8");

      for (const line of source.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }

        try {
          this.ingestStoredEvent(JSON.parse(line) as unknown);
        } catch {
          // Keep loading later events if one line is malformed.
        }
      }
    } catch {
      // The store is best-effort: runtime alerts should not fail because of a local log issue.
    }
  }

  private ingestStoredEvent(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    if (value.type === "signal") {
      const alertId = typeof value.alertId === "string" ? value.alertId : "";
      const symbol = typeof value.symbol === "string" ? value.symbol.trim().toUpperCase() : "";
      const createdAt = isFiniteNumber(value.createdAt) ? value.createdAt : 0;

      if (!alertId || !symbol || !createdAt) {
        return;
      }

      this.signalIds.add(alertId);
      this.lastSignalAtBySymbol.set(
        symbol,
        Math.max(this.lastSignalAtBySymbol.get(symbol) ?? 0, createdAt)
      );
      return;
    }

    if (value.type !== "reviving_coin") {
      return;
    }

    const event = this.normalizeRevivingCoinEvent(value);
    if (!event) {
      return;
    }

    this.revivingEvents.unshift(event);
    this.revivingEvents.splice(500);
    this.lastRevivingAtBySymbol.set(
      event.symbol,
      Math.max(this.lastRevivingAtBySymbol.get(event.symbol) ?? 0, event.detectedAt)
    );
  }

  private normalizeRevivingCoinEvent(value: Record<string, unknown>): RevivingCoinEventRecord | null {
    const id = typeof value.id === "string" ? value.id : "";
    const alertId = typeof value.alertId === "string" ? value.alertId : "";
    const symbol = typeof value.symbol === "string" ? value.symbol.trim().toUpperCase() : "";
    const baseAsset = typeof value.baseAsset === "string" ? value.baseAsset : symbol;
    const detectedAt = isFiniteNumber(value.detectedAt) ? value.detectedAt : 0;

    if (!id || !alertId || !symbol || !detectedAt) {
      return null;
    }

    const criteria = isRecord(value.criteria) ? value.criteria : {};

    return {
      id,
      alertId,
      symbol,
      baseAsset,
      quoteVolume24h: isFiniteNumber(value.quoteVolume24h) ? value.quoteVolume24h : 0,
      averageDailyQuoteVolume: isFiniteNumber(value.averageDailyQuoteVolume)
        ? value.averageDailyQuoteVolume
        : null,
      volumeChangePct: isFiniteNumber(value.volumeChangePct) ? value.volumeChangePct : null,
      liquidityLookbackDays: isFiniteNumber(value.liquidityLookbackDays)
        ? value.liquidityLookbackDays
        : 30,
      noSignalLookbackDays: isFiniteNumber(value.noSignalLookbackDays)
        ? value.noSignalLookbackDays
        : 30,
      detectedAt,
      criteria: {
        lowAverageVolume: criteria.lowAverageVolume === true,
        noRecentSignals: criteria.noRecentSignals === true,
        requireAllDeadCriteria: criteria.requireAllDeadCriteria === true
      },
      settingsSnapshot: value.settingsSnapshot as RevivingCoinAlertSettings
    };
  }

  private appendEvent(event: StoredMarketEvent): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFile(
        this.filePath,
        `${JSON.stringify(event)}\n`,
        (error) => {
          if (error) {
            console.warn("Could not persist market event", error);
          }
        }
      );
    } catch (error) {
      console.warn("Could not persist market event", error);
    }
  }
}
