export interface WindowTotals {
  buy: number;
  sell: number;
}

export interface LiquidationTotals {
  longsHit: number;
  shortsHit: number;
}

interface PricePoint {
  time: number;
  value: number;
}

interface FlowPoint {
  time: number;
  buy: number;
  sell: number;
}

interface LiquidationPoint {
  time: number;
  longsHit: number;
  shortsHit: number;
}

interface ValuePoint {
  time: number;
  value: number;
}

export class TimedPriceSeries {
  private readonly points: PricePoint[] = [];

  constructor(private readonly retentionMs = 300_000) {}

  push(time: number, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const bucketTime = Math.floor(time / 1000) * 1000;
    const last = this.points[this.points.length - 1];

    if (last && last.time === bucketTime) {
      last.value = value;
    } else {
      this.points.push({ time: bucketTime, value });
    }

    this.prune(bucketTime);
  }

  latest(): number | null {
    return this.points[this.points.length - 1]?.value ?? null;
  }

  latestTime(): number | null {
    return this.points[this.points.length - 1]?.time ?? null;
  }

  deltaPctAgo(windowMs: number): number {
    const latest = this.points[this.points.length - 1];
    if (!latest) {
      return 0;
    }

    const previous = this.valueAgo(windowMs);
    if (previous === null || previous === 0) {
      return 0;
    }

    return ((latest.value - previous) / previous) * 100;
  }

  deltaAbsAgo(windowMs: number): number {
    const latest = this.points[this.points.length - 1];
    if (!latest) {
      return 0;
    }

    const previous = this.valueAgo(windowMs);
    if (previous === null) {
      return 0;
    }

    return latest.value - previous;
  }

  snapshot(windowMs: number): PricePoint[] {
    const latest = this.points[this.points.length - 1];
    if (!latest) {
      return [];
    }

    const cutoff = latest.time - windowMs;
    return this.points.filter((point) => point.time >= cutoff).map((point) => ({ ...point }));
  }

  returnSeries(windowMs: number): number[] {
    const points = this.snapshot(windowMs);
    if (points.length < 2) {
      return [];
    }

    const returns: number[] = [];

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];

      if (!previous || !current || previous.value <= 0 || current.value <= 0) {
        continue;
      }

      returns.push((current.value - previous.value) / previous.value);
    }

    return returns;
  }

  private valueAgo(windowMs: number): number | null {
    const latest = this.points[this.points.length - 1];
    if (!latest) {
      return null;
    }

    const target = latest.time - windowMs;

    for (let index = this.points.length - 1; index >= 0; index -= 1) {
      const point = this.points[index];
      if (point && point.time <= target) {
        return point.value;
      }
    }

    return null;
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs;

    while (true) {
      const first = this.points[0];
      if (!first || first.time >= cutoff) {
        break;
      }
      this.points.shift();
    }
  }
}

export class TimedValueSeries {
  private readonly points: ValuePoint[] = [];

  constructor(private readonly retentionMs = 300_000) {}

  push(time: number, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const bucketTime = Math.floor(time / 1000) * 1000;
    const last = this.points[this.points.length - 1];

    if (last && last.time === bucketTime) {
      last.value = value;
    } else {
      this.points.push({ time: bucketTime, value });
    }

    this.prune(bucketTime);
  }

  latest(): number | null {
    return this.points[this.points.length - 1]?.value ?? null;
  }

  deltaAgo(windowMs: number): number {
    const latest = this.points[this.points.length - 1];
    if (!latest) {
      return 0;
    }

    const previous = this.valueAgo(windowMs);
    if (previous === null) {
      return 0;
    }

    return latest.value - previous;
  }

  deltaPctAgo(windowMs: number): number {
    const latest = this.points[this.points.length - 1];
    if (!latest) {
      return 0;
    }

    const previous = this.valueAgo(windowMs);
    if (previous === null || previous === 0) {
      return 0;
    }

    return ((latest.value - previous) / previous) * 100;
  }

  snapshot(windowMs: number): ValuePoint[] {
    const latest = this.points[this.points.length - 1];
    if (!latest) {
      return [];
    }

    const cutoff = latest.time - windowMs;
    return this.points.filter((point) => point.time >= cutoff).map((point) => ({ ...point }));
  }

  private valueAgo(windowMs: number): number | null {
    const latest = this.points[this.points.length - 1];
    if (!latest) {
      return null;
    }

    const target = latest.time - windowMs;

    for (let index = this.points.length - 1; index >= 0; index -= 1) {
      const point = this.points[index];
      if (point && point.time <= target) {
        return point.value;
      }
    }

    return null;
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs;

    while (true) {
      const first = this.points[0];
      if (!first || first.time >= cutoff) {
        break;
      }
      this.points.shift();
    }
  }
}

export class TimedFlowBuffer {
  private readonly points: FlowPoint[] = [];

  constructor(private readonly retentionMs = 300_000) {}

  push(time: number, buy: number, sell: number): void {
    const bucketTime = Math.floor(time / 1000) * 1000;
    const last = this.points[this.points.length - 1];

    if (last && last.time === bucketTime) {
      last.buy += buy;
      last.sell += sell;
    } else {
      this.points.push({ time: bucketTime, buy, sell });
    }

    this.prune(bucketTime);
  }

  sumWindow(windowMs: number): WindowTotals {
    const last = this.points[this.points.length - 1];
    if (!last) {
      return { buy: 0, sell: 0 };
    }

    const cutoff = last.time - windowMs;
    let buy = 0;
    let sell = 0;

    for (let index = this.points.length - 1; index >= 0; index -= 1) {
      const point = this.points[index];
      if (!point || point.time < cutoff) {
        break;
      }

      buy += point.buy;
      sell += point.sell;
    }

    return { buy, sell };
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs;

    while (true) {
      const first = this.points[0];
      if (!first || first.time >= cutoff) {
        break;
      }
      this.points.shift();
    }
  }
}

export class TimedLiquidationBuffer {
  private readonly points: LiquidationPoint[] = [];

  constructor(private readonly retentionMs = 300_000) {}

  push(time: number, longsHit: number, shortsHit: number): void {
    const bucketTime = Math.floor(time / 1000) * 1000;
    const last = this.points[this.points.length - 1];

    if (last && last.time === bucketTime) {
      last.longsHit += longsHit;
      last.shortsHit += shortsHit;
    } else {
      this.points.push({ time: bucketTime, longsHit, shortsHit });
    }

    this.prune(bucketTime);
  }

  sumWindow(windowMs: number): LiquidationTotals {
    const last = this.points[this.points.length - 1];
    if (!last) {
      return { longsHit: 0, shortsHit: 0 };
    }

    const cutoff = last.time - windowMs;
    let longsHit = 0;
    let shortsHit = 0;

    for (let index = this.points.length - 1; index >= 0; index -= 1) {
      const point = this.points[index];
      if (!point || point.time < cutoff) {
        break;
      }

      longsHit += point.longsHit;
      shortsHit += point.shortsHit;
    }

    return { longsHit, shortsHit };
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs;

    while (true) {
      const first = this.points[0];
      if (!first || first.time >= cutoff) {
        break;
      }
      this.points.shift();
    }
  }
}
