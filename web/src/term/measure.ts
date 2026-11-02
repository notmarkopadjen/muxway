// The browser's monospace cell, measured once, and the font size that
// makes a pane of cols × rows fill a box.

let cell: { w: number; h: number; px: number } | null = null;
let cellFor = '';

export function measureCell(): { w: number; h: number; px: number } {
  const size = document.documentElement.style.getPropertyValue('--mx-screen-size');
  if (cell && cellFor === size) return cell;
  // The probe is the screen's own markup, so the cell is the one drawn:
  // a bare pre would take the browser's monospace font and line height.
  const probe = document.createElement('div');
  probe.className = 'mx-screen';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.padding = '0';
  probe.style.border = '0';
  // The screen keeps room for its scrollbar; the glyph does not.
  probe.style.overflow = 'visible';
  probe.style.scrollbarGutter = 'auto';
  const pre = document.createElement('pre');
  for (let i = 0; i < 10; i++) {
    const ln = document.createElement('div');
    ln.className = 'ln';
    ln.textContent = 'MMMMMMMMMM';
    pre.appendChild(ln);
  }
  probe.appendChild(pre);
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize) || 14;
  const rect = pre.getBoundingClientRect();
  probe.remove();
  cell = { w: rect.width / 10, h: rect.height / 10, px };
  cellFor = size;
  return cell;
}

// The box's inside, in layout pixels: clientWidth and clientHeight leave
// the border out and the padding in. Not the bounding rectangle, which the
// CRT power-on transform scales and a ResizeObserver never reports.
export function inner(el: HTMLElement): { w: number; h: number } {
  const cs = getComputedStyle(el);
  return {
    w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
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
