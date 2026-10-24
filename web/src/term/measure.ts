// The browser's monospace cell, measured once, and the font size that
// makes a pane of cols × rows fill a box.

let cell: { w: number; h: number; px: number } | null = null;

export function measureCell(): { w: number; h: number; px: number } {
  if (cell) return cell;
  const probe = document.createElement('pre');
  probe.className = 'mx-screen';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.padding = '0';
  probe.style.border = '0';
  probe.textContent = Array(10).fill('MMMMMMMMMM').join('\n');
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize) || 14;
  const rect = probe.getBoundingClientRect();
  probe.remove();
  cell = { w: rect.width / 10, h: rect.height / 10, px };
  return cell;
}

// How many columns and rows fit in a box at the default font.
export function cellsFor(boxW: number, boxH: number): { cols: number; rows: number } {
  const c = measureCell();
  return { cols: Math.max(1, Math.floor(boxW / c.w)), rows: Math.max(1, Math.floor(boxH / c.h)) };
}

// The font size at which cols × rows fill the box, clamped.
export function fontFor(cols: number, rows: number, boxW: number, boxH: number, scale = 1): number {
  const c = measureCell();
  const byW = (boxW / cols) * (c.px / c.w);
  const byH = (boxH / rows) * (c.px / c.h);
  return Math.max(6, Math.min(byW, byH, c.px * 1.6)) * scale;
}
