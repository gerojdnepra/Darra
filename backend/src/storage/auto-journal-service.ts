import type {
  BinanceAccountRiskPositionSnapshot,
  BinanceAccountRiskSnapshot
} from "../services/binance-account-stream";
import type { JournalEntryRecord, SignalRecord } from "./signal-repository";
import { signalRepository, SignalRepository } from "./signal-repository";

export type AutoJournalEventType = "created" | "updated" | "closed";

export interface AutoJournalEvent {
  event: AutoJournalEventType;
  journalEntry: JournalEntryRecord;
}

interface TrackedAutoJournalPosition {
  symbol: string;
  side: "long" | "short";
  entryPrice: number | null;
  size: number;
  pnl: number | null;
  markPrice: number | null;
  startedAt: number;
  journalEntryId: string;
  updateSignature: string;
}

const LINK_WINDOW_MS = 30 * 60 * 1000;
const AUTO_NOTE = "Auto-created from Binance position";
const LINKED_NOTE = "linked signal setup/opportunity";
const CLOSED_NOTE = "Auto-closed from Binance position";
const PNL_WARNING_NOTE = "Warning: exact realized PnL unavailable; kept last known unrealized PnL.";
const AUTO_TAGS = ["auto", "binance-position"];

const toNullableFinite = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const mergeTags = (...groups: Array<Array<string | null | undefined>>): string[] =>
  Array.from(
    new Set(
      groups
        .flat()
        .map((tag) => tag?.trim())
        .filter((tag): tag is string => Boolean(tag))
    )
  );

const appendNotes = (...parts: Array<string | null | undefined>): string =>
  Array.from(
    new Set(
      parts
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
    )
  ).join("\n");

const positionSide = (position: BinanceAccountRiskPositionSnapshot): "long" | "short" =>
  position.quantity > 0 ? "long" : "short";

const positionKey = (position: Pick<BinanceAccountRiskPositionSnapshot, "symbol" | "quantity">): string =>
  `${position.symbol}:${position.quantity > 0 ? "long" : "short"}`;

const updateSignature = (position: BinanceAccountRiskPositionSnapshot): string =>
  [
    Math.abs(position.quantity),
    toNullableFinite(position.unrealizedPnl),
    toNullableFinite(position.markPrice)
  ].join(":");

export class AutoJournalService {
  private activeAutoJournalPositions = new Map<string, TrackedAutoJournalPosition>();

  constructor(
    private readonly enabled: boolean,
    private readonly repository: SignalRepository = signalRepository
  ) {}

  reset(): void {
    this.activeAutoJournalPositions.clear();
  }

  observe(snapshot: BinanceAccountRiskSnapshot): AutoJournalEvent[] {
    if (!this.enabled) {
      return [];
    }

    if (!snapshot.enabled) {
      this.reset();
      return [];
    }

    const activePositions = snapshot.positions.filter((position) => Math.abs(position.quantity) > 0);
    const activeKeys = new Set(activePositions.map(positionKey));
    const events: AutoJournalEvent[] = [];

    for (const position of activePositions) {
      const key = positionKey(position);
      const tracked = this.activeAutoJournalPositions.get(key);

      if (!tracked) {
        const event = this.createEntry(position);
        if (event) {
          events.push(event);
        }
        continue;
      }

      const nextSignature = updateSignature(position);
      if (tracked.updateSignature !== nextSignature) {
        const event = this.updateEntry(tracked, position, nextSignature);
        if (event) {
          events.push(event);
        }
      }
    }

    for (const [key, tracked] of Array.from(this.activeAutoJournalPositions.entries())) {
      if (activeKeys.has(key)) {
        continue;
      }

      const event = this.closeEntry(key, tracked);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  private createEntry(position: BinanceAccountRiskPositionSnapshot): AutoJournalEvent | null {
    try {
      const side = positionSide(position);
      const existingOpenEntry = this.repository.findOpenAutoJournalEntry(position.symbol, side);

      if (existingOpenEntry) {
        this.activeAutoJournalPositions.set(positionKey(position), {
          symbol: position.symbol,
          side,
          entryPrice: existingOpenEntry.entryPrice,
          size: existingOpenEntry.size ?? Math.abs(position.quantity),
          pnl: existingOpenEntry.pnl,
          markPrice: toNullableFinite(position.markPrice),
          startedAt: existingOpenEntry.createdAt,
          journalEntryId: existingOpenEntry.id,
          updateSignature: updateSignature(position)
        });

        const updated = this.repository.updateJournalEntry(existingOpenEntry.id, {
          size: Math.abs(position.quantity),
          pnl: toNullableFinite(position.unrealizedPnl)
        });

        return updated ? { event: "updated", journalEntry: updated } : null;
      }

      const linkedSignal = this.repository.findLatestJournalLinkSignal(
        position.symbol,
        Date.now() - LINK_WINDOW_MS
      );
      const tags = mergeTags(
        AUTO_TAGS,
        linkedSignal ? [linkedSignal.setupType, linkedSignal.opportunityVerdict] : []
      );
      const notes = appendNotes(AUTO_NOTE, linkedSignal ? LINKED_NOTE : null);
      const entry = this.repository.createJournalEntry({
        signalId: linkedSignal?.id ?? null,
        symbol: position.symbol,
        side,
        entryPrice: toNullableFinite(position.entryPrice),
        size: Math.abs(position.quantity),
        pnl: toNullableFinite(position.unrealizedPnl),
        notes,
        tags
      });

      this.activeAutoJournalPositions.set(positionKey(position), {
        symbol: position.symbol,
        side,
        entryPrice: toNullableFinite(position.entryPrice),
        size: Math.abs(position.quantity),
        pnl: toNullableFinite(position.unrealizedPnl),
        markPrice: toNullableFinite(position.markPrice),
        startedAt: Date.now(),
        journalEntryId: entry.id,
        updateSignature: updateSignature(position)
      });

      return { event: "created", journalEntry: entry };
    } catch (error) {
      console.warn("Auto journal create failed", error);
      return null;
    }
  }

  private updateEntry(
    tracked: TrackedAutoJournalPosition,
    position: BinanceAccountRiskPositionSnapshot,
    nextSignature: string
  ): AutoJournalEvent | null {
    try {
      const updated = this.repository.updateJournalEntry(tracked.journalEntryId, {
        size: Math.abs(position.quantity),
        pnl: toNullableFinite(position.unrealizedPnl)
      });

      tracked.size = Math.abs(position.quantity);
      tracked.pnl = toNullableFinite(position.unrealizedPnl);
      tracked.markPrice = toNullableFinite(position.markPrice);
      tracked.updateSignature = nextSignature;

      return updated ? { event: "updated", journalEntry: updated } : null;
    } catch (error) {
      console.warn("Auto journal update failed", error);
      return null;
    }
  }

  private closeEntry(key: string, tracked: TrackedAutoJournalPosition): AutoJournalEvent | null {
    try {
      const existing = this.repository.getJournalEntryById(tracked.journalEntryId);
      const updated = this.repository.updateJournalEntry(tracked.journalEntryId, {
        exitPrice: tracked.markPrice,
        pnl: tracked.pnl,
        notes: appendNotes(existing?.notes, CLOSED_NOTE, PNL_WARNING_NOTE),
        tags: mergeTags(existing?.tags ?? [], ["closed"])
      });

      this.activeAutoJournalPositions.delete(key);

      return updated ? { event: "closed", journalEntry: updated } : null;
    } catch (error) {
      console.warn("Auto journal close failed", error);
      return null;
    }
  }
}
