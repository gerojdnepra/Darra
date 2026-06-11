export const compactUsd = (value: number): string => {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
};

export const formatPercent = (value: number, digits = 2): string => {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
};

export const formatPrice = (value: number): string => {
  if (value >= 1000) {
    return value.toFixed(2);
  }
  if (value >= 1) {
    return value.toFixed(4);
  }
  return value.toFixed(6);
};

export const formatClock = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
};
