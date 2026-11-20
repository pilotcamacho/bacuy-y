/**
 * Where lines are: on the page, or off it (hidden for now, completed, archived). Shown as tabs of the "Page"
 * section (components/LineTabs), so the main navigation does not grow with every list; the
 * main nav keeps "Page" active on all of them.
 */
export const LINE_TABS: { to: string; key: string }[] = [
  { to: "/", key: "lines.tabs.page" },
  { to: "/hidden", key: "lines.tabs.hidden" },
  { to: "/expirations", key: "lines.tabs.expirations" },
  { to: "/completed", key: "lines.tabs.completed" },
  { to: "/archived", key: "lines.tabs.archived" },
];

export const LINE_PATHS = LINE_TABS.map((tab) => tab.to);
