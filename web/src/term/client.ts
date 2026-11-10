// This browser's label for the fits it sends, shown by the other clients
// as "held by web · Chrome": the browser's family, nothing more.
export function browserLabel(
  ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): string {
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'browser';
}

export const CLIENT_LABEL = browserLabel();
