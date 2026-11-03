import { qrModules } from './qr';

// A QR code as a PNG: the modules drawn on a canvas, black on white with
// the quiet zone, for the clipboard or a download. Nothing of the text
// is in the image but the code itself.
export function qrPng(text: string, cell = 8): Promise<Blob | null> {
  const m = qrModules(text);
  if (!m) return Promise.resolve(null);
  const quiet = 4;
  const n = m.length + 2 * quiet;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n * cell;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
    }),
  );
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

// Puts the image on the clipboard; false where the browser refuses images there.
export async function copyPng(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
