import { qrModules } from '../qr';

// A QR code as an inline SVG: black on white whatever the theme, with the
// quiet zone a scanner needs. Nothing of the text is in the markup.
export function Qr({ text, label, size = 160 }: { text: string; label: string; size?: number }) {
  const m = qrModules(text);
  if (!m) return null;
  const quiet = 4;
  const n = m.length + 2 * quiet;
  let d = '';
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return (
    <svg
      className="mx-qr"
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      data-testid="qr"
      data-modules={m.length}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
