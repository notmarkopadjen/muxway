// A burst of calls settles into few: the first runs at once, the rest
// within the window fold into one that runs after the last of them, then
// the window opens again. One slot per key, so panes settle apart.
export class Settle {
  private slots = new Map<
    string,
    { last: number; pending?: () => void; timer?: ReturnType<typeof setTimeout> }
  >();
  constructor(private span: number) {}

  run(key: string, fn: () => void) {
    const now = Date.now();
    const s = this.slots.get(key) ?? { last: -Infinity };
    this.slots.set(key, s);
    if (s.timer === undefined && now - s.last >= this.span) {
      s.last = now;
      fn();
      return;
    }
    s.pending = fn;
    if (s.timer === undefined)
      s.timer = setTimeout(
        () => {
          s.timer = undefined;
          const go = s.pending;
          s.pending = undefined;
          if (!go) return;
          s.last = Date.now();
          go();
        },
        s.last + this.span - now,
      );
  }
}
