// A grant pattern's first segment names the host, with * for any run of
// characters, as the hub reads it. The client only asks whether a host is
// named at all, to show or hide what needs a write grant there.
export function mayWriteOn(write: string[], host: string): boolean {
  return write.some((pattern) => {
    const seg = pattern.split('/')[0];
    const re = new RegExp('^' + seg.split('*').map(escape).join('.*') + '$');
    return re.test(host);
  });
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
