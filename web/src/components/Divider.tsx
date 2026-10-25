// A draggable bar between two slots of a split; reports pointer movement.
// While a header is dragged it is also a drop target: the pane goes across
// the split, on the side of the bar's half the pointer is in.
export function Divider({
  kind,
  onDrag,
  dropping,
  onOver,
  onDropHere,
}: {
  kind: 'h' | 'v';
  onDrag: (dx: number, dy: number) => void;
  dropping?: boolean;
  onOver?: (first: boolean | null) => void;
  onDropHere?: (first: boolean) => void;
}) {
  const half = (e: React.DragEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return kind === 'h' ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
  };
  return (
    <div
      className={`mx-divider mx-divider-${kind}${dropping && onDropHere ? ' mx-divider-drop' : ''}`}
      data-testid="divider"
      onDragOver={
        dropping && onDropHere
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onOver?.(half(e));
            }
          : undefined
      }
      onDragLeave={dropping ? () => onOver?.(null) : undefined}
      onDrop={
        dropping && onDropHere
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onOver?.(null);
              onDropHere(half(e));
            }
          : undefined
      }
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
