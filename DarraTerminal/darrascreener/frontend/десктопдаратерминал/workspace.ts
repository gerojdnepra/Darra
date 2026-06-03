import type {
  LayoutPreset,
  TerminalWidgetId,
  WorkspaceFloatingWindow,
  WorkspaceLayoutNode,
  WorkspaceLeafNode,
  WorkspacePane,
  WorkspaceSplitDirection,
  WorkspaceSplitNode,
  WorkspaceState,
  WorkspaceTab,
  WorkspaceWidgetTab
} from "./types";

const paneCountByLayout: Record<LayoutPreset, number> = {
  single: 1,
  split: 2,
  triple: 3,
  quad: 4
};

const defaultWidgetsByLayout: Record<LayoutPreset, TerminalWidgetId[]> = {
  single: ["quotes"],
  split: ["orderbook", "chart"],
  triple: ["quotes", "orderbook", "chart"],
  quad: ["quotes", "orderbook", "chart", "signalTape"]
};

const createWorkspaceId = (prefix = "desktop-darra"): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const isWidget = (value: unknown): value is TerminalWidgetId =>
  typeof value === "string" &&
  ["chart", "orderbook", "quotes", "watchlist", "signalTape", "tradePad"].includes(value);

const isLayout = (value: unknown): value is LayoutPreset =>
  typeof value === "string" && ["single", "split", "triple", "quad"].includes(value);

const isSplitDirection = (value: unknown): value is WorkspaceSplitDirection =>
  value === "row" || value === "column";

const cloneWidgetTab = (tab: WorkspaceWidgetTab): WorkspaceWidgetTab => ({
  ...tab
});

const cloneLeafNode = (leaf: WorkspaceLeafNode): WorkspaceLeafNode => ({
  ...leaf,
  tabs: leaf.tabs.map(cloneWidgetTab)
});

const cloneWorkspaceNode = (node: WorkspaceLayoutNode): WorkspaceLayoutNode =>
  node.type === "leaf"
    ? cloneLeafNode(node)
    : {
        ...node,
        children: node.children.map(cloneWorkspaceNode),
        sizes: node.sizes ? [...node.sizes] : undefined
      };

const normalizeSplitNode = (node: WorkspaceSplitNode): WorkspaceLayoutNode => {
  const children = node.children.filter(Boolean);

  if (children.length === 0) {
    return createWorkspaceLeaf("quotes");
  }

  if (children.length === 1) {
    return children[0];
  }

  return {
    ...node,
    children,
    sizes:
      node.sizes && node.sizes.length === children.length
        ? [...node.sizes]
        : Array.from({ length: children.length }, () => 1 / children.length)
  };
};

const mergeLeafTabs = (
  primary: WorkspaceLeafNode,
  incoming: WorkspaceLeafNode[]
): WorkspaceLeafNode => {
  if (incoming.length === 0) {
    return cloneLeafNode(primary);
  }

  const tabs = [
    ...primary.tabs.map(cloneWidgetTab),
    ...incoming.flatMap((leaf) => leaf.tabs.map(cloneWidgetTab))
  ];

  return {
    ...primary,
    tabs,
    activeTabId: primary.activeTabId || tabs[0]?.id || createWorkspaceWidgetTab("quotes").id
  };
};

const flattenLeafsIntoPanes = (root: WorkspaceLayoutNode): WorkspacePane[] =>
  collectWorkspaceLeaves(root).map((leaf) => {
    const activeTab = leaf.tabs.find((tab) => tab.id === leaf.activeTabId) ?? leaf.tabs[0];

    return {
      id: leaf.id,
      widget: activeTab?.widget ?? "quotes"
    };
  });

const buildRootFromLeaves = (
  layout: LayoutPreset,
  inputLeaves: WorkspaceLeafNode[]
): WorkspaceLayoutNode => {
  const defaults = defaultWidgetsByLayout[layout];
  const targetCount = paneCountByLayout[layout];
  const sourceLeaves = inputLeaves.length > 0 ? inputLeaves.map(cloneLeafNode) : [];
  const baseLeaves = Array.from({ length: targetCount }, (_, index) => {
    const existing = sourceLeaves[index];

    if (existing) {
      return existing;
    }

    return createWorkspaceLeaf(defaults[index] ?? "quotes");
  });
  const overflowLeaves = sourceLeaves.slice(targetCount);

  if (overflowLeaves.length > 0) {
    const lastIndex = Math.max(baseLeaves.length - 1, 0);
    baseLeaves[lastIndex] = mergeLeafTabs(baseLeaves[lastIndex], overflowLeaves);
  }

  if (layout === "single") {
    return baseLeaves[0];
  }

  if (layout === "split") {
    return createWorkspaceSplit("row", baseLeaves.slice(0, 2), [0.48, 0.52]);
  }

  if (layout === "triple") {
    return createWorkspaceSplit("row", baseLeaves.slice(0, 3), [0.24, 0.36, 0.4]);
  }

  const topRow = createWorkspaceSplit("row", [baseLeaves[0], baseLeaves[1]], [0.42, 0.58]);
  const bottomRow = createWorkspaceSplit("row", [baseLeaves[2], baseLeaves[3]], [0.58, 0.42]);

  return createWorkspaceSplit("column", [topRow, bottomRow], [0.58, 0.42]);
};

const normalizeWidgetTab = (value: unknown): WorkspaceWidgetTab | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const widget = isWidget(record.widget) ? record.widget : null;

  if (!widget) {
    return null;
  }

  return {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : createWorkspaceWidgetTab(widget).id,
    widget
  };
};

const normalizeWorkspaceNode = (
  value: unknown,
  fallbackWidget: TerminalWidgetId
): WorkspaceLayoutNode => {
  if (!value || typeof value !== "object") {
    return createWorkspaceLeaf(fallbackWidget);
  }

  const record = value as Record<string, unknown>;

  if (record.type === "split" && Array.isArray(record.children)) {
    const direction = isSplitDirection(record.direction) ? record.direction : "row";
    const children = record.children.map((child) => normalizeWorkspaceNode(child, fallbackWidget));

    return normalizeSplitNode({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : `split-${createWorkspaceId()}`,
      type: "split",
      direction,
      children,
      sizes: Array.isArray(record.sizes)
        ? record.sizes
            .map((size) => (typeof size === "number" && Number.isFinite(size) ? Math.max(size, 0) : 0))
            .filter((size) => size > 0)
        : undefined
    });
  }

  const tabs = Array.isArray(record.tabs)
    ? record.tabs.map(normalizeWidgetTab).filter((tab): tab is WorkspaceWidgetTab => tab !== null)
    : [];
  const fallbackTab = createWorkspaceWidgetTab(fallbackWidget);
  const resolvedTabs = tabs.length > 0 ? tabs : [fallbackTab];
  const activeTabId =
    typeof record.activeTabId === "string" &&
    resolvedTabs.some((tab) => tab.id === record.activeTabId)
      ? record.activeTabId
      : resolvedTabs[0].id;

  return {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `leaf-${createWorkspaceId()}`,
    type: "leaf",
    tabs: resolvedTabs,
    activeTabId
  };
};

const normalizeFloatingWindow = (value: unknown): WorkspaceFloatingWindow | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const root = normalizeWorkspaceNode(record.root, "quotes");

  if (root.type !== "leaf") {
    return null;
  }

  return {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `float-${createWorkspaceId()}`,
    title:
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : "Detached window",
    x: typeof record.x === "number" && Number.isFinite(record.x) ? record.x : 72,
    y: typeof record.y === "number" && Number.isFinite(record.y) ? record.y : 72,
    width: typeof record.width === "number" && Number.isFinite(record.width) ? Math.max(record.width, 280) : 360,
    height:
      typeof record.height === "number" && Number.isFinite(record.height) ? Math.max(record.height, 240) : 420,
    root
  };
};

export const createWorkspaceWidgetTab = (widget: TerminalWidgetId): WorkspaceWidgetTab => ({
  id: `widget-${createWorkspaceId()}`,
  widget
});

export const createWorkspacePane = (widget: TerminalWidgetId): WorkspacePane => ({
  id: `pane-${createWorkspaceId()}`,
  widget
});

export const createWorkspaceLeaf = (
  widgets: TerminalWidgetId | TerminalWidgetId[]
): WorkspaceLeafNode => {
  const list = Array.isArray(widgets) ? widgets : [widgets];
  const tabs = list.length > 0 ? list.map(createWorkspaceWidgetTab) : [createWorkspaceWidgetTab("quotes")];

  return {
    id: `leaf-${createWorkspaceId()}`,
    type: "leaf",
    tabs,
    activeTabId: tabs[0].id
  };
};

export const createWorkspaceSplit = (
  direction: WorkspaceSplitDirection,
  children: WorkspaceLayoutNode[],
  sizes?: number[]
): WorkspaceSplitNode => ({
  id: `split-${createWorkspaceId()}`,
  type: "split",
  direction,
  children,
  sizes
});

export const collectWorkspaceLeaves = (node: WorkspaceLayoutNode): WorkspaceLeafNode[] =>
  node.type === "leaf" ? [node] : node.children.flatMap(collectWorkspaceLeaves);

export const syncTabPanesToLayout = (
  tab: WorkspaceTab,
  layout: LayoutPreset
): WorkspaceTab => {
  const sourceRoot =
    tab.root && typeof tab.root === "object"
      ? cloneWorkspaceNode(tab.root)
      : buildRootFromLeaves(
          tab.layout,
          tab.panes.map((pane) => createWorkspaceLeaf(pane.widget))
        );
  const root = buildRootFromLeaves(layout, collectWorkspaceLeaves(sourceRoot));

  return {
    ...tab,
    layout,
    root,
    panes: flattenLeafsIntoPanes(root)
  };
};

export const createWorkspaceTab = (
  index: number,
  symbol: string | null = null,
  layout: LayoutPreset = "triple"
): WorkspaceTab => {
  const root = buildRootFromLeaves(layout, []);

  return {
    id: `tab-${createWorkspaceId()}`,
    title: `Р’РєР»Р°РґРєР° ${index}`,
    symbol,
    layout,
    root,
    panes: flattenLeafsIntoPanes(root),
    floatingWindows: []
  };
};

export const createDefaultWorkspaceState = (): WorkspaceState => {
  const firstTab = createWorkspaceTab(1);

  return {
    activeTabId: firstTab.id,
    tabs: [firstTab]
  };
};

const isLegacyTwoPaneDefaultTab = (tab: WorkspaceTab): boolean => {
  const widgets = flattenLeafsIntoPanes(tab.root).map((pane) => pane.widget);

  return (
    tab.layout === "split" &&
    tab.symbol === null &&
    tab.floatingWindows.length === 0 &&
    widgets.length === 2 &&
    widgets[0] === "orderbook" &&
    widgets[1] === "chart"
  );
};

export const normalizeWorkspaceState = (value: unknown): WorkspaceState => {
  if (!value || typeof value !== "object") {
    return createDefaultWorkspaceState();
  }

  const candidateTabs = Array.isArray((value as { tabs?: unknown }).tabs)
    ? (value as { tabs: unknown[] }).tabs
    : [];

  const tabs = candidateTabs
    .map((tabValue, index) => {
      if (!tabValue || typeof tabValue !== "object") {
        return null;
      }

      const tabRecord = tabValue as Record<string, unknown>;
      const layout = isLayout(tabRecord.layout) ? tabRecord.layout : "triple";
      const rawPanes = Array.isArray(tabRecord.panes) ? tabRecord.panes : [];
      const panes = rawPanes
        .map((paneValue) => {
          if (!paneValue || typeof paneValue !== "object") {
            return null;
          }

          const paneRecord = paneValue as Record<string, unknown>;
          const widget = isWidget(paneRecord.widget) ? paneRecord.widget : null;

          if (!widget) {
            return null;
          }

          return {
            id:
              typeof paneRecord.id === "string" && paneRecord.id.trim()
                ? paneRecord.id.trim()
                : `pane-${createWorkspaceId()}`,
            widget
          } satisfies WorkspacePane;
        })
        .filter((pane): pane is WorkspacePane => pane !== null);
      const legacyLeaves =
        panes.length > 0 ? panes.map((pane) => createWorkspaceLeaf(pane.widget)) : [];
      const root = tabRecord.root
        ? normalizeWorkspaceNode(
            tabRecord.root,
            panes[0]?.widget ?? defaultWidgetsByLayout[layout][0] ?? "quotes"
          )
        : buildRootFromLeaves(layout, legacyLeaves);
      const floatingWindows = Array.isArray(tabRecord.floatingWindows)
        ? tabRecord.floatingWindows
            .map(normalizeFloatingWindow)
            .filter((windowItem): windowItem is WorkspaceFloatingWindow => windowItem !== null)
        : [];
      const normalizedTab: WorkspaceTab = {
        id:
          typeof tabRecord.id === "string" && tabRecord.id.trim()
            ? tabRecord.id.trim()
            : `tab-${createWorkspaceId()}`,
        title:
          typeof tabRecord.title === "string" && tabRecord.title.trim()
            ? tabRecord.title.trim()
            : `Р’РєР»Р°РґРєР° ${index + 1}`,
        symbol:
          typeof tabRecord.symbol === "string" && tabRecord.symbol.trim()
            ? tabRecord.symbol.trim().toUpperCase()
            : null,
        layout,
        root,
        panes: flattenLeafsIntoPanes(root),
        floatingWindows
      };

      return normalizedTab;
    })
    .filter((tab): tab is WorkspaceTab => tab !== null);

  const resolvedTabs = tabs.length > 0 ? tabs : createDefaultWorkspaceState().tabs;
  const migratedTabs =
    resolvedTabs.length === 1 && isLegacyTwoPaneDefaultTab(resolvedTabs[0])
      ? createDefaultWorkspaceState().tabs
      : resolvedTabs;
  const activeTabId =
    typeof (value as { activeTabId?: unknown }).activeTabId === "string" &&
    migratedTabs.some((tab) => tab.id === (value as { activeTabId: string }).activeTabId)
      ? (value as { activeTabId: string }).activeTabId
      : migratedTabs[0].id;

  return {
    activeTabId,
    tabs: migratedTabs
  };
};
