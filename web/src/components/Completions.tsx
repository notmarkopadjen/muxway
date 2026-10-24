// The list above the input line while its first word is typed. A click
// takes a row; the keys are the field's, which keeps the focus.
export function Completions({
  items,
  picked,
  onTake,
}: {
  items: string[];
  picked: number;
  onTake: (c: string) => void;
}) {
  return (
    <div className="mx-complete" role="listbox" data-testid="complete">
      {items.map((c, i) => (
        <div
          key={c}
          role="option"
          aria-selected={i === picked}
          className={i === picked ? 'mx-picked' : undefined}
          data-testid="completion"
          data-text={c}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onTake(c)}
        >
          {i === picked ? '▸ ' : '  '}
          {c}
        </div>
      ))}
    </div>
  );
}
