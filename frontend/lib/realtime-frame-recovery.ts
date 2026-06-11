import type {
  CompactFrameTablePayload,
  CompactFundingSortedPayload,
  FrameTransportCapability,
  FramePatchMessage,
  FrameSnapshotMessage,
  ScreenerFrame,
  ServerMessage
} from "@/lib/types";

export type SnapshotRequestReason =
  | "initial_connect"
  | "manual"
  | "gap_detected"
  | "missing_frame_state"
  | "missing_transport_seq"
  | "non_monotonic_seq";

export interface RealtimeFrameTransportState {
  lastFrameSeq: number | null;
  awaitingSnapshot: boolean;
}

export interface SnapshotRequestMessage {
  type: "request_snapshot";
  payload: {
    reason: SnapshotRequestReason;
    lastSeenSeq?: number | null;
    expectedBaseSeq?: number | null;
    receivedFrameSeq?: number | null;
  };
}

export interface ApplyRealtimeFrameResult {
  nextFrame: ScreenerFrame | null;
  nextState: RealtimeFrameTransportState;
  requestSnapshot: SnapshotRequestMessage | null;
  applied: boolean;
}

type SequencedFrameSnapshotMessage = FrameSnapshotMessage & {
  frameSeq?: number;
  baseSeq?: number | null;
};

type SequencedFramePatchMessage = FramePatchMessage & {
  frameSeq?: number;
  baseSeq?: number | null;
};

export const heavyClientFrameTransportCapabilities: FrameTransportCapability[] = [
  "compact_frame_transport_v1"
];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizeSeq = (value: unknown): number | null =>
  isFiniteNumber(value) ? Math.trunc(value) : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCompactTablePayload = (value: unknown): value is CompactFrameTablePayload =>
  isRecord(value) &&
  value.__compact === "table_v1" &&
  Array.isArray(value.columns) &&
  Array.isArray(value.rows);

const isCompactFundingSortedPayload = (value: unknown): value is CompactFundingSortedPayload =>
  isRecord(value) &&
  value.__compact === "funding_sorted_order_v1" &&
  Array.isArray(value.highest) &&
  Array.isArray(value.lowest) &&
  Array.isArray(value.basis);

const isCompactTableDeltaPayload = (
  value: unknown
): value is {
  __compact: "table_delta_v1";
  columns: string[];
  keyColumn: string;
  upserts: unknown[][];
  removes: unknown[];
  order?: unknown[];
} =>
  isRecord(value) &&
  value.__compact === "table_delta_v1" &&
  Array.isArray(value.columns) &&
  Array.isArray(value.upserts) &&
  Array.isArray(value.removes);

const setNestedValue = (target: Record<string, unknown>, path: string, value: unknown): void => {
  const segments = path.split(".");
  let current: Record<string, unknown> = target;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) {
      return;
    }

    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }

    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }
};

const decodeCompactTable = (payload: CompactFrameTablePayload): Record<string, unknown>[] =>
  payload.rows.map((rowValues) => {
    const row: Record<string, unknown> = {};

    payload.columns.forEach((column, index) => {
      setNestedValue(row, column, rowValues[index] ?? null);
    });

    return row;
  });

const applyCompactTableDelta = (
  payload: {
    columns: string[];
    keyColumn: string;
    upserts: unknown[][];
    removes: unknown[];
    order?: unknown[];
  },
  baseRows: unknown
): Record<string, unknown>[] => {
  const existingRows = Array.isArray(baseRows) ? baseRows : [];
  const byKey = new Map<string, Record<string, unknown>>();

  for (const row of existingRows) {
    if (!isRecord(row)) {
      continue;
    }

    const key = row[payload.keyColumn];
    if (typeof key === "string") {
      byKey.set(key, { ...row });
    }
  }

  for (const key of payload.removes) {
    if (typeof key === "string") {
      byKey.delete(key);
    }
  }

  const decodedUpserts = decodeCompactTable({
    __compact: "table_v1",
    columns: payload.columns,
    rows: payload.upserts as CompactFrameTablePayload["rows"]
  });

  for (const row of decodedUpserts) {
    const key = row[payload.keyColumn];
    if (typeof key === "string") {
      byKey.set(key, row);
    }
  }

  const orderedKeys = Array.isArray(payload.order)
    ? payload.order.filter((key): key is string => typeof key === "string")
    : [];

  if (orderedKeys.length > 0) {
    return orderedKeys
      .map((key) => byKey.get(key))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }

  return Array.from(byKey.values());
};

const decodeFundingSortedPayload = (
  payload: CompactFundingSortedPayload,
  fundingRows: unknown
) => {
  const fundingArray = Array.isArray(fundingRows) ? fundingRows : [];
  const fundingBySymbol = new Map(
    fundingArray
      .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.symbol === "string")
      .map((item) => [item.symbol as string, item])
  );
  const resolveOrder = (symbols: string[]): Record<string, unknown>[] =>
    symbols
      .map((symbol) => fundingBySymbol.get(symbol))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({ ...item }));

  return {
    highest: resolveOrder(payload.highest as string[]),
    lowest: resolveOrder(payload.lowest as string[]),
    basis: resolveOrder(payload.basis as string[])
  };
};

const decodeMetaRegimeGovernor = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.overlays)) {
    return value;
  }

  const execution = isCompactTablePayload(value.overlays.execution)
    ? decodeCompactTable(value.overlays.execution)
    : value.overlays.execution;
  const allocation = isCompactTablePayload(value.overlays.allocation)
    ? decodeCompactTable(value.overlays.allocation)
    : value.overlays.allocation;

  return {
    ...value,
    overlays: {
      ...value.overlays,
      execution,
      allocation
    }
  };
};

const decodeRegimeMemory = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    symbols: isCompactTablePayload(value.symbols) ? decodeCompactTable(value.symbols) : value.symbols
  };
};

const expandCompactFrame = (
  frameLike: ScreenerFrame,
  baseFrame: ScreenerFrame | null = null
): ScreenerFrame => {
  const nextFrame = {
    ...frameLike
  } as ScreenerFrame;

  if (isCompactTablePayload(frameLike.rows)) {
    nextFrame.rows = decodeCompactTable(frameLike.rows) as unknown as ScreenerFrame["rows"];
  } else if (isCompactTableDeltaPayload(frameLike.rows)) {
    nextFrame.rows = applyCompactTableDelta(
      frameLike.rows,
      baseFrame?.rows ?? []
    ) as unknown as ScreenerFrame["rows"];
  }
  if (isCompactTablePayload(frameLike.funding)) {
    nextFrame.funding = decodeCompactTable(frameLike.funding) as unknown as ScreenerFrame["funding"];
  }
  if (isCompactTablePayload(frameLike.marketFlow)) {
    nextFrame.marketFlow = decodeCompactTable(frameLike.marketFlow) as unknown as ScreenerFrame["marketFlow"];
  }
  if (isCompactTablePayload(frameLike.regime)) {
    nextFrame.regime = decodeCompactTable(frameLike.regime) as unknown as ScreenerFrame["regime"];
  }
  if (isCompactTablePayload(frameLike.signalIntelligence)) {
    nextFrame.signalIntelligence = decodeCompactTable(
      frameLike.signalIntelligence
    ) as unknown as ScreenerFrame["signalIntelligence"];
  }
  if (isCompactFundingSortedPayload(frameLike.fundingSorted)) {
    nextFrame.fundingSorted = decodeFundingSortedPayload(
      frameLike.fundingSorted,
      nextFrame.funding ?? baseFrame?.funding ?? []
    ) as unknown as ScreenerFrame["fundingSorted"];
  }
  if (frameLike.metaRegimeGovernor) {
    nextFrame.metaRegimeGovernor = decodeMetaRegimeGovernor(
      frameLike.metaRegimeGovernor
    ) as unknown as ScreenerFrame["metaRegimeGovernor"];
  }
  if (frameLike.regimeMemory) {
    nextFrame.regimeMemory = decodeRegimeMemory(
      frameLike.regimeMemory
    ) as unknown as ScreenerFrame["regimeMemory"];
  }

  return nextFrame;
};

export const createRealtimeFrameTransportState = (): RealtimeFrameTransportState => ({
  lastFrameSeq: null,
  awaitingSnapshot: false
});

export const buildSnapshotRequestMessage = (
  state: RealtimeFrameTransportState,
  reason: SnapshotRequestReason,
  details: {
    expectedBaseSeq?: number | null;
    receivedFrameSeq?: number | null;
  } = {}
): SnapshotRequestMessage => {
  const payload: SnapshotRequestMessage["payload"] = {
    reason,
    lastSeenSeq: state.lastFrameSeq
  };

  if (details.expectedBaseSeq !== undefined) {
    payload.expectedBaseSeq = details.expectedBaseSeq;
  }

  if (details.receivedFrameSeq !== undefined) {
    payload.receivedFrameSeq = details.receivedFrameSeq;
  }

  return {
    type: "request_snapshot",
    payload
  };
};

const requestFullResync = (
  state: RealtimeFrameTransportState,
  reason: SnapshotRequestReason,
  details: {
    expectedBaseSeq?: number | null;
    receivedFrameSeq?: number | null;
  } = {}
): ApplyRealtimeFrameResult => ({
  nextFrame: null,
  nextState: {
    ...state,
    awaitingSnapshot: true
  },
  requestSnapshot: buildSnapshotRequestMessage(state, reason, details),
  applied: false
});

export const applyRealtimeFrameMessage = (
  state: RealtimeFrameTransportState,
  currentFrame: ScreenerFrame | null,
  message: ServerMessage
): ApplyRealtimeFrameResult | null => {
  if (message.type === "snapshot") {
    const snapshot = message as SequencedFrameSnapshotMessage;
    const nextFrame = expandCompactFrame(snapshot.frame);

    return {
      nextFrame,
      nextState: {
        lastFrameSeq: normalizeSeq(snapshot.frameSeq),
        awaitingSnapshot: false
      },
      requestSnapshot: null,
      applied: true
    };
  }

  if (message.type === "frame_patch") {
    const patch = message as SequencedFramePatchMessage;
    const frameSeq = normalizeSeq(patch.frameSeq);
    const baseSeq = normalizeSeq(patch.baseSeq);

    if (frameSeq === null || baseSeq === null) {
      if (state.awaitingSnapshot) {
        return {
          nextFrame: currentFrame,
          nextState: state,
          requestSnapshot: null,
          applied: false
        };
      }

      return requestFullResync(state, "missing_transport_seq", {
        expectedBaseSeq: baseSeq,
        receivedFrameSeq: frameSeq
      });
    }

    if (state.awaitingSnapshot) {
      return {
        nextFrame: currentFrame,
        nextState: state,
        requestSnapshot: null,
        applied: false
      };
    }

    const expandedChanged = expandCompactFrame(
      patch.changed as ScreenerFrame,
      currentFrame
    );

    if (!currentFrame || state.lastFrameSeq === null) {
      return requestFullResync(state, "missing_frame_state", {
        expectedBaseSeq: baseSeq,
        receivedFrameSeq: frameSeq
      });
    }

    if (frameSeq <= state.lastFrameSeq) {
      return requestFullResync(state, "non_monotonic_seq", {
        expectedBaseSeq: state.lastFrameSeq,
        receivedFrameSeq: frameSeq
      });
    }

    if (baseSeq !== state.lastFrameSeq) {
      return requestFullResync(state, "gap_detected", {
        expectedBaseSeq: baseSeq,
        receivedFrameSeq: frameSeq
      });
    }

    return {
      nextFrame: {
        ...currentFrame,
        ...expandedChanged
      },
      nextState: {
        lastFrameSeq: frameSeq,
        awaitingSnapshot: false
      },
      requestSnapshot: null,
      applied: true
    };
  }

  if (message.type === "frame") {
    return {
      nextFrame: message,
      nextState: createRealtimeFrameTransportState(),
      requestSnapshot: null,
      applied: true
    };
  }

  return null;
};
