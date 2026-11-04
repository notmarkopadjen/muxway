// The word on a host's line in the pane list: the host is offline, or
// online with nothing its owner exposed (the guideline's third state),
// or online with panes. While the listing is still on its way, or a
// filter hides every pane, the host is only online.
export function hostState(
  online: boolean,
  listed: boolean,
  panes: number,
  filtered: boolean,
): 'offline' | 'online' | 'nothing exposed' {
  if (!online) return 'offline';
  if (listed && panes === 0 && !filtered) return 'nothing exposed';
  return 'online';
}
