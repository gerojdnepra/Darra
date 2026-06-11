import type {
  DeltaFrameClientState,
  DeltaFramePayload,
  DeltaFrameRecoveryTelemetry,
  SnapshotRequestPayload,
  DeltaFrameTelemetryMetrics,
  FramePatchMessage,
  FrameSnapshotMessage,
  ProjectedFrame
} from "./types";

const bytesPerKb = 1024;
const compactTableMarker = "table_v1";
const compactTableDeltaMarker = "table_delta_v1";

const toKb = (bytes: number): number => Number((bytes / bytesPerKb).toFixed(2));

const measureBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizeSeq = (value: unknown): number | null =>
  isFiniteNumber(value) ? Math.trunc(value) : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCompactTablePayload = (
  value: unknown
): value is { __compact: string; columns: string[]; rows: unknown[][] } =>
  isRecord(value) &&
  value.__compact === compactTableMarker &&
  Array.isArray(value.columns) &&
  Array.isArray(value.rows);

const hashText = (hash: number, value: string): number => {
  let nextHash = hash;

  for (let index = 0; index < value.length; index += 1) {
    nextHash ^= value.charCodeAt(index);
    nextHash = Math.imul(nextHash, 16_777_619);
  }

  return nextHash >>> 0;
};

const hashCell = (hash: number, value: unknown): number => {
  if (value === null) {
    return hashText(hashText(hash, "null"), "|");
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return hashText(hashText(hashText(hash, valueType), ":"), `${value}|`);
  }

  if (valueType === "undefined") {
    return hashText(hashText(hash, "undefined"), "|");
  }

  return hashText(hashText(hashText(hash, valueType), ":"), `${JSON.stringify(value) ?? "null"}|`);
};

const createCompactRowSignature = (row: unknown[]): string => {
  let hash = 2_166_136_261;

  for (const cell of row) {
    hash = hashCell(hash, cell);
  }

  return hash.toString(36);
};

const buildCompactRowsSignatures = (
  rows: unknown,
  keyIndex?: number
): Record<string, string> | null => {
  if (!isCompactTablePayload(rows)) {
    return null;
  }

  const resolvedKeyIndex = keyIndex ?? rows.columns.indexOf("symbol");
  if (resolvedKeyIndex < 0) {
    return null;
  }

  const signaturesBySymbol: Record<string, string> = {};
  for (const row of rows.rows) {
    const symbol = row[resolvedKeyIndex];
    if (typeof symbol === "string") {
      signaturesBySymbol[symbol] = createCompactRowSignature(row);
    }
  }

  return signaturesBySymbol;
};

const buildCompactRowsDelta = (
  nextRows: unknown,
  previousRows: unknown,
  previousSignaturesBySymbol: Record<string, string> | null
): {
  payload: unknown;
  changedRows: number;
  addedRows: number;
  removedRows: number;
  signaturesBySymbol: Record<string, string>;
  hasChanges: boolean;
  usesDelta: boolean;
} | null => {
  if (!isCompactTablePayload(nextRows) || !isCompactTablePayload(previousRows)) {
    return null;
  }

  const keyIndex = nextRows.columns.indexOf("symbol");
  const previousKeyIndex = previousRows.columns.indexOf("symbol");
  if (keyIndex < 0 || previousKeyIndex < 0 || nextRows.columns.join("|") !== previousRows.columns.join("|")) {
    return null;
  }

  const previousBySymbol = new Map<string, unknown[]>();
  for (const row of previousRows.rows) {
    const symbol = row[previousKeyIndex];
    if (typeof symbol === "string") {
      previousBySymbol.set(symbol, row);
    }
  }

  const seenSymbols = new Set<string>();
  const upserts: unknown[][] = [];
  const order: string[] = [];
  const nextSignaturesBySymbol = buildCompactRowsSignatures(nextRows, keyIndex) ?? {};
  let addedRows = 0;

  for (const row of nextRows.rows) {
    const symbol = row[keyIndex];
    if (typeof symbol !== "string") {
      continue;
    }

    seenSymbols.add(symbol);
    order.push(symbol);
    const previous = previousBySymbol.get(symbol);
    if (!previous) {
      addedRows += 1;
      upserts.push(row);
      continue;
    }

    const nextSignature = nextSignaturesBySymbol[symbol];
    const previousSignature = previousSignaturesBySymbol?.[symbol];
    const rowChanged =
      nextSignature && previousSignature
        ? nextSignature !== previousSignature
        : JSON.stringify(row) !== JSON.stringify(previous);

    if (rowChanged) {
      upserts.push(row);
    }
  }

  const removes = Array.from(previousBySymbol.keys()).filter((symbol) => !seenSymbols.has(symbol));
  const previousOrder = previousRows.rows
    .map((row) => row[previousKeyIndex])
    .filter((symbol): symbol is string => typeof symbol === "string");
  const orderChanged =
    order.length !== previousOrder.length ||
    order.some((symbol, index) => symbol !== previousOrder[index]);
  const hasChanges = upserts.length > 0 || removes.length > 0 || orderChanged;

  if (!hasChanges) {
    return {
      payload: null,
      changedRows: 0,
      addedRows,
      removedRows: 0,
      signaturesBySymbol: nextSignaturesBySymbol,
      hasChanges: false,
      usesDelta: false
    };
  }

  const payload = {
    __compact: compactTableDeltaMarker,
    columns: nextRows.columns,
    keyColumn: "symbol",
    upserts,
    removes,
    order
  };
  const fullRowsBytes = measureBytes(nextRows);
  const deltaRowsBytes = measureBytes(payload);

  if (deltaRowsBytes >= fullRowsBytes) {
    return {
      payload: nextRows,
      changedRows: upserts.length + removes.length,
      addedRows,
      removedRows: removes.length,
      signaturesBySymbol: nextSignaturesBySymbol,
      hasChanges: true,
      usesDelta: false
    };
  }

  return {
    payload,
    changedRows: upserts.length + removes.length,
    addedRows,
    removedRows: removes.length,
    signaturesBySymbol: nextSignaturesBySymbol,
    hasChanges: true,
    usesDelta: true
  };
};

type DeltaFrameDiagnostics = Pick<
  DeltaFrameTelemetryMetrics,
  | "deltaRowsMs"
  | "deltaSectionCompareMs"
  | "deltaPatchMeasureMs"
  | "deltaFullMeasureMs"
  | "deltaRowsFastPathHit"
  | "deltaComparedSectionsCount"
  | "deltaChangedSectionsCount"
>;

const normalizeSnapshotRequestReason = (value: unknown): string => {
  if (typeof value !== "string") {
    return "manual";
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : "manual";
};

const describeSnapshotRequest = (payload: SnapshotRequestPayload | undefined): string => {
  const reason = normalizeSnapshotRequestReason(payload?.reason);
  const details: string[] = [];
  const lastSeenSeq = normalizeSeq(payload?.lastSeenSeq);
  const expectedBaseSeq = normalizeSeq(payload?.expectedBaseSeq);
  const receivedFrameSeq = normalizeSeq(payload?.receivedFrameSeq);

  if (lastSeenSeq !== null) {
    details.push(`lastSeenSeq=${lastSeenSeq}`);
  }
  if (expectedBaseSeq !== null) {
    details.push(`expectedBaseSeq=${expectedBaseSeq}`);
  }
  if (receivedFrameSeq !== null) {
    details.push(`receivedFrameSeq=${receivedFrameSeq}`);
  }

  return details.length > 0 ? `${reason} (${details.join(", ")})` : reason;
};

const createTelemetryMetrics = (
  state: DeltaFrameClientState,
  fullPayloadSizeKb: number,
  actualPayloadSizeKb: number,
  actualPayloadSizeBytes: number,
  diagnostics: DeltaFrameDiagnostics = {}
): DeltaFrameTelemetryMetrics => {
  const savedByDeltaKb = Math.max(fullPayloadSizeKb - actualPayloadSizeKb, 0);
  const totalSavedByDeltaKb = state.totalSavedByDeltaKb + savedByDeltaKb;
  const patchFramesSent = state.patchFramesSent;
  const rollingPatchSampleCount = Math.min(patchFramesSent, 30);

  return {
    deltaEnabled: true,
    snapshotFramesSent: state.snapshotFramesSent,
    patchFramesSent,
    patchSizeBytes: actualPayloadSizeBytes,
    patchSizeKb: actualPayloadSizeKb,
    averagePatchSizeKb:
      rollingPatchSampleCount > 0
        ? Number((state.totalPatchSizeKb / rollingPatchSampleCount).toFixed(2))
        : 0,
    savedByDeltaKb: Number(totalSavedByDeltaKb.toFixed(2)),
    deltaRatio:
      fullPayloadSizeKb > 0 ? Number((actualPayloadSizeKb / fullPayloadSizeKb).toFixed(4)) : 1,
    ...diagnostics
  };
};

const createRecoveryTelemetry = (
  state: DeltaFrameClientState
): DeltaFrameRecoveryTelemetry => ({
  lastClientSeenSeq: state.lastClientSeenSeq,
  forcedFullResyncs: state.forcedFullResyncs,
  desyncEvents: state.desyncEvents,
  lastDesyncAt: state.lastDesyncAt,
  lastDesyncReason: state.lastDesyncReason,
  lastRecoveryAt: state.lastRecoveryAt,
  lastRecoveryReason: state.lastRecoveryReason
});

const applyTelemetryMetrics = (
  frame: ProjectedFrame,
  metrics: DeltaFrameTelemetryMetrics
): void => {
  if (!frame.frameTelemetry) {
    return;
  }

  Object.assign(frame.frameTelemetry, metrics);
};

const cloneProjectedFrame = (frame: ProjectedFrame): ProjectedFrame => {
  const nextFrame: ProjectedFrame = { ...frame };

  if (frame.frameTelemetry) {
    nextFrame.frameTelemetry = { ...frame.frameTelemetry };
  }

  return nextFrame;
};

export class DeltaFrameEngine {
  createClientState(): DeltaFrameClientState {
    return {
      lastSentFrame: null,
      compactRowsSignaturesBySymbol: null,
      snapshotFramesSent: 0,
      patchFramesSent: 0,
      totalPatchSizeKb: 0,
      totalSavedByDeltaKb: 0,
      lastSentSeq: 0,
      lastClientSeenSeq: null,
      forcedFullResyncs: 0,
      desyncEvents: 0,
      lastDesyncAt: null,
      lastDesyncReason: null,
      lastRecoveryAt: null,
      lastRecoveryReason: null,
      pendingRecoveryReason: null
    };
  }

  noteSnapshotRequest(
    state: DeltaFrameClientState,
    payload: SnapshotRequestPayload | undefined
  ): void {
    const lastSeenSeq = normalizeSeq(payload?.lastSeenSeq);
    if (lastSeenSeq !== null) {
      state.lastClientSeenSeq = lastSeenSeq;
    }

    const reason = normalizeSnapshotRequestReason(payload?.reason);
    if (reason === "manual" || reason === "initial_connect") {
      return;
    }

    state.desyncEvents += 1;
    state.lastDesyncAt = Date.now();
    state.lastDesyncReason = describeSnapshotRequest(payload);
    state.pendingRecoveryReason = state.lastDesyncReason;
  }

  build(
    state: DeltaFrameClientState,
    projectedFrame: ProjectedFrame,
    options: { forceSnapshot?: boolean } = {}
  ): DeltaFramePayload {
    const nextFrame = cloneProjectedFrame(projectedFrame);
    const nextSeqCandidate = state.lastSentSeq + 1;
    const diagnostics: DeltaFrameDiagnostics = {
      deltaRowsMs: 0,
      deltaSectionCompareMs: 0,
      deltaPatchMeasureMs: 0,
      deltaFullMeasureMs: 0,
      deltaRowsFastPathHit: false,
      deltaComparedSectionsCount: 0,
      deltaChangedSectionsCount: 0
    };
    const snapshotCandidate = {
      type: "snapshot",
      frame: nextFrame,
      frameSeq: nextSeqCandidate,
      baseSeq: null,
      recovery: createRecoveryTelemetry(state)
    };
    const fullMeasureStartedAt = Date.now();
    const fullPayloadSizeKb = toKb(measureBytes(snapshotCandidate));
    diagnostics.deltaFullMeasureMs = Date.now() - fullMeasureStartedAt;

    if (!state.lastSentFrame || options.forceSnapshot) {
      state.snapshotFramesSent += 1;
      state.lastSentSeq += 1;

      if (options.forceSnapshot && state.pendingRecoveryReason) {
        state.forcedFullResyncs += 1;
        state.lastRecoveryAt = Date.now();
        state.lastRecoveryReason = state.pendingRecoveryReason;
        state.pendingRecoveryReason = null;
      }

      const snapshot: FrameSnapshotMessage = {
        type: "snapshot",
        frame: nextFrame,
        frameSeq: state.lastSentSeq,
        baseSeq: null,
        recovery: createRecoveryTelemetry(state)
      };
      const snapshotSizeBytes = measureBytes(snapshot);
      const snapshotSizeKb = toKb(snapshotSizeBytes);
      applyTelemetryMetrics(
        nextFrame,
        createTelemetryMetrics(state, fullPayloadSizeKb, snapshotSizeKb, snapshotSizeBytes, diagnostics)
      );

      state.lastSentFrame = nextFrame;
      state.compactRowsSignaturesBySymbol = buildCompactRowsSignatures(nextFrame.rows);
      return snapshot;
    }

    const changed: Partial<ProjectedFrame> = {};
    const baseSeq = state.lastSentSeq;
    const nextSeq = baseSeq + 1;

    for (const [section, value] of Object.entries(nextFrame) as Array<[keyof ProjectedFrame, unknown]>) {
      const previousValue = state.lastSentFrame[section];
      diagnostics.deltaComparedSectionsCount = (diagnostics.deltaComparedSectionsCount ?? 0) + 1;

      if (section === "rows" && isCompactTablePayload(value) && isCompactTablePayload(previousValue)) {
        diagnostics.deltaRowsFastPathHit = true;
        const rowsStartedAt = Date.now();
        const rowsDelta = buildCompactRowsDelta(
          value,
          previousValue,
          state.compactRowsSignaturesBySymbol
        );
        diagnostics.deltaRowsMs = (diagnostics.deltaRowsMs ?? 0) + Date.now() - rowsStartedAt;

        if (rowsDelta?.hasChanges) {
          (changed as Record<string, unknown>)[section as string] = rowsDelta.payload;
          diagnostics.deltaChangedSectionsCount = (diagnostics.deltaChangedSectionsCount ?? 0) + 1;
        }

        if (nextFrame.frameTelemetry) {
          Object.assign(nextFrame.frameTelemetry as unknown as Record<string, unknown>, {
            rowsChangedCount: rowsDelta?.changedRows ?? null,
            rowsAddedCount: rowsDelta?.addedRows ?? null,
            rowsRemovedCount: rowsDelta?.removedRows ?? null,
            rowsDeltaEnabled: Boolean(rowsDelta?.usesDelta)
          });
        }

        continue;
      }

      const sectionCompareStartedAt = Date.now();
      const sectionChanged = JSON.stringify(value) !== JSON.stringify(previousValue);
      diagnostics.deltaSectionCompareMs =
        (diagnostics.deltaSectionCompareMs ?? 0) + Date.now() - sectionCompareStartedAt;

      if (sectionChanged) {
        const rowsDelta =
          section === "rows"
            ? buildCompactRowsDelta(value, previousValue, state.compactRowsSignaturesBySymbol)
            : null;
        (changed as Record<string, unknown>)[section as string] = rowsDelta?.payload ?? value;
        diagnostics.deltaChangedSectionsCount = (diagnostics.deltaChangedSectionsCount ?? 0) + 1;
        if (section === "rows" && nextFrame.frameTelemetry) {
          Object.assign(nextFrame.frameTelemetry as unknown as Record<string, unknown>, {
            rowsChangedCount: rowsDelta?.changedRows ?? null,
            rowsAddedCount: rowsDelta?.addedRows ?? null,
            rowsRemovedCount: rowsDelta?.removedRows ?? null,
            rowsDeltaEnabled: Boolean(rowsDelta?.usesDelta)
          });
        }
      }
    }

    let patch: FramePatchMessage = {
      type: "frame_patch",
      frameSeq: nextSeq,
      baseSeq,
      changed,
      recovery: createRecoveryTelemetry(state)
    };
    const patchMeasureStartedAt = Date.now();
    let patchSizeBytes = measureBytes(patch);
    diagnostics.deltaPatchMeasureMs = (diagnostics.deltaPatchMeasureMs ?? 0) + Date.now() - patchMeasureStartedAt;
    let patchSizeKb = toKb(patchSizeBytes);

    state.patchFramesSent += 1;
    state.totalPatchSizeKb += patchSizeKb;
    if (state.patchFramesSent > 30) {
      state.totalPatchSizeKb = state.totalPatchSizeKb * (29 / 30) + patchSizeKb;
    }

    const telemetryMetrics = createTelemetryMetrics(
      state,
      fullPayloadSizeKb,
      patchSizeKb,
      patchSizeBytes,
      diagnostics
    );
    applyTelemetryMetrics(nextFrame, telemetryMetrics);

    if (nextFrame.frameTelemetry) {
      patch = {
        type: "frame_patch",
        frameSeq: nextSeq,
        baseSeq,
        changed: {
          ...changed,
          frameTelemetry: nextFrame.frameTelemetry
        },
        recovery: createRecoveryTelemetry(state)
      };
      const previousPatchSizeKb = patchSizeKb;
      const telemetryPatchMeasureStartedAt = Date.now();
      patchSizeBytes = measureBytes(patch);
      diagnostics.deltaPatchMeasureMs =
        (diagnostics.deltaPatchMeasureMs ?? 0) + Date.now() - telemetryPatchMeasureStartedAt;
      patchSizeKb = toKb(patchSizeBytes);
      state.totalPatchSizeKb += patchSizeKb - previousPatchSizeKb;
      if (state.patchFramesSent > 30) {
        state.totalPatchSizeKb = state.totalPatchSizeKb * (29 / 30) + patchSizeKb;
      }
      applyTelemetryMetrics(
        nextFrame,
        createTelemetryMetrics(state, fullPayloadSizeKb, patchSizeKb, patchSizeBytes, diagnostics)
      );
    }

    state.totalSavedByDeltaKb += Math.max(fullPayloadSizeKb - patchSizeKb, 0);
    state.lastSentSeq = nextSeq;
    state.lastSentFrame = nextFrame;
    state.compactRowsSignaturesBySymbol =
      buildCompactRowsSignatures(nextFrame.rows) ?? state.compactRowsSignaturesBySymbol;

    return patch;
  }
}
