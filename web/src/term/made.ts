// Panes this client made, oldest first. A new pane's tab goes to the end
// of the strip, never between the tabs that were already there: tmux
// numbers panes by place, so a pane split beside the first one lands in
// the middle of the listing. They are kept by pane id, which a layout
// does not renumber, and kept until the person signs out; the last
// sixteen, so a long session does not grow a list.
//
// Once the owner has dragged a tab, the whole strip is in the stored
// order (see order.ts) and that order has the last word: a pane named
// there is no longer moved.

const made: string[] = [];

const MADE_MAX = 16;

export function noteMade(paneID: string) {
  if (!paneID || made.includes(paneID)) return;
  made.push(paneID);
  if (made.length > MADE_MAX) made.splice(0, made.length - MADE_MAX);
}

export function forgetMade() {
  made.length = 0;
}

// The panes with the ones made here at the end, in the order they were
// made. `ranked` are the addresses the owner's own order names.
export function madeLast<T extends { address: string; pane_id: string }>(
  panes: T[],
  ranked: string[] = [],
): T[] {
  if (!made.length) return panes;
  const rank = new Set(ranked);
  const last = made
    .map((id) => panes.find((p) => p.pane_id === id))
    .filter((p): p is T => !!p && !rank.has(p.address));
  if (!last.length) return panes;
  return [...panes.filter((p) => !last.includes(p)), ...last];
}
