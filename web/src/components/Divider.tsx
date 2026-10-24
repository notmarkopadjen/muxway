// A draggable bar between two slots of a split; reports pointer movement.
export function Divider({
  kind,
  onDrag,
}: {
  kind: 'h' | 'v';
  onDrag: (dx: number, dy: number) => void;
}) {
  return (
    <div
      className={`mx-divider mx-divider-${kind}`}
      data-testid="divider"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        let lx = e.clientX;
        let ly = e.clientY;
        const move = (ev: PointerEvent) => {
          onDrag(ev.clientX - lx, ev.clientY - ly);
          lx = ev.clientX;
          ly = ev.clientY;
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
    />
  );
}
