export type TerminalWidgetId = "orderbook" | "chart" | "quotes" | "tables";

export interface DarraWorkspaceTab {
  id: string;
  index: number;
  symbol: string | null;
  widgets: TerminalWidgetId[];
}

export interface DarraWorkspaceState {
  activeTabId: string;
  tabs: DarraWorkspaceTab[];
}

const terminalWidgetIds: TerminalWidgetId[] = ["orderbook", "chart", "quotes", "tables"];
const terminalWidgetSet = new Set<TerminalWidgetId>(terminalWidgetIds);

const createWorkspaceId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const createWorkspaceTab = (
  index: number,
  symbol: string | null = null
): DarraWorkspaceTab => ({
  id: `tab-${createWorkspaceId()}`,
  index,
  symbol,
  widgets: []
});

export const createDefaultDarraWorkspaceState = (): DarraWorkspaceState => {
  const firstTab = createWorkspaceTab(1);

  return {
    activeTabId: firstTab.id,
    tabs: [firstTab]
  };
};

const normalizeWidgetId = (value: unknown): TerminalWidgetId | null =>
  typeof value === "string" && terminalWidgetSet.has(value as TerminalWidgetId)
    ? (value as TerminalWidgetId)
    : null;

export const normalizeDarraWorkspaceState = (value: unknown): DarraWorkspaceState => {
  if (!value || typeof value !== "object") {
    return createDefaultDarraWorkspaceState();
  }

  const candidateTabs = Array.isArray((value as { tabs?: unknown }).tabs)
    ? (value as { tabs: unknown[] }).tabs
    : [];
  const normalizedTabs = candidateTabs
    .map((tab, index) => {
      if (!tab || typeof tab !== "object") {
        return null;
      }

      const tabRecord = tab as Record<string, unknown>;
      const widgets = Array.isArray(tabRecord.widgets)
        ? tabRecord.widgets
            .map((widgetId) => normalizeWidgetId(widgetId))
            .filter((widgetId): widgetId is TerminalWidgetId => widgetId !== null)
        : [];

      return {
        id:
          typeof tabRecord.id === "string" && tabRecord.id.trim()
            ? tabRecord.id.trim()
            : `tab-${createWorkspaceId()}`,
        index:
          typeof tabRecord.index === "number" && Number.isFinite(tabRecord.index)
            ? Math.max(1, Math.round(tabRecord.index))
            : index + 1,
        symbol:
          typeof tabRecord.symbol === "string" && tabRecord.symbol.trim()
            ? tabRecord.symbol.trim().toUpperCase()
            : null,
        widgets: widgets.filter(
          (widgetId, widgetIndex) => widgets.indexOf(widgetId) === widgetIndex
        )
      } satisfies DarraWorkspaceTab;
    })
    .filter((tab): tab is DarraWorkspaceTab => tab !== null);

  const tabs = normalizedTabs.length > 0 ? normalizedTabs : createDefaultDarraWorkspaceState().tabs;
  const activeTabId =
    typeof (value as { activeTabId?: unknown }).activeTabId === "string" &&
    tabs.some((tab) => tab.id === (value as { activeTabId: string }).activeTabId)
      ? (value as { activeTabId: string }).activeTabId
      : tabs[0].id;

  return {
    activeTabId,
    tabs
  };
};
