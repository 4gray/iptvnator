import type { DownloadPlatform } from './platforms';

/**
 * Best-effort guess of the visitor's desktop OS, used only to pre-select a
 * download button. Runs in the browser; the server-rendered markup must
 * already be correct for the "unknown" case, since the guess can be wrong and
 * phones get `null`.
 */
export function detectPlatform(): DownloadPlatform | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const hints = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  if (hints?.mobile) {
    return null;
  }
  const source = `${hints?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  if (/android|iphone|ipad|ipod/i.test(source)) {
    return null;
  }
  if (/mac/i.test(source)) {
    return 'macos';
  }
  if (/win/i.test(source)) {
    return 'windows';
  }
  if (/linux|x11|cros/i.test(source)) {
    return 'linux';
  }
  return null;
}
