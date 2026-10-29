// The strip in the owner's order: the panes whose address was dragged
// into place come first, in that order; the rest follow in listing
// order. The stored list keeps addresses the listing lacks for now, so
// a host that is away for a minute keeps its places.

export const ORDER_MAX = 256;

export function inOrder<T extends { address: string }>(panes: T[], order: string[]): T[] {
  const rank = new Map(order.map((a, i) => [a, i]));
  const placed = panes
    .filter((p) => rank.has(p.address))
    .sort((a, b) => rank.get(a.address)! - rank.get(b.address)!);
  return [...placed, ...panes.filter((p) => !rank.has(p.address))];
}

// The stored list after a drag: the whole strip as shown, with the
// dragged address put before `before` (last when null), then the stored
// addresses the strip does not show. One drag fixes every place.
export function move(
  order: string[],
  strip: string[],
  dragged: string,
  before: string | null,
): string[] {
  if (!strip.includes(dragged) || dragged === before) return order;
  const rest = strip.filter((a) => a !== dragged);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at < 0) return order;
  rest.splice(at, 0, dragged);
  const away = order.filter((a) => !strip.includes(a));
  return [...rest, ...away].slice(0, ORDER_MAX);
}

// One place left or right; nothing past either end.
export function step(order: string[], strip: string[], address: string, dir: 1 | -1): string[] {
  const i = strip.indexOf(address);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= strip.length) return order;
  return move(order, strip, address, dir > 0 ? (strip[j + 1] ?? null) : strip[j]);
}
