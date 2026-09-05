import type { DownloadPlatform } from './platforms';

/**
 * Best-effort guess of the visitor's desktop OS, used only to pre-select a
 * download button. Runs in the browser; the server-rendered markup must
 * already be correct for the "unknown" case, since the guess can be wrong and
 * phones get `null`.
 *
 * Sources are consulted in order of trust: the user-agent string first (every
 * browser sends one and it is what a visitor's spoofing or testing tools
 * change), then the client-hints platform, then the deprecated
 * `navigator.platform`. The first source that yields a verdict wins, so a
 * source that is silent (an empty hint) falls through instead of vetoing.
 */
export function detectPlatform(): DownloadPlatform | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const hints = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  if (hints?.mobile) {
    return null;
  }
  const sources = [navigator.userAgent, hints?.platform, navigator.platform];
  for (const source of sources) {
    const verdict = classify(source ?? '');
    if (verdict !== undefined) {
      return verdict;
    }
  }
  return null;
}

/** `null` means "a phone or tablet, offer nothing"; `undefined` means "no opinion". */
function classify(source: string): DownloadPlatform | null | undefined {
  if (!source) {
    return undefined;
  }
  if (/android|iphone|ipad|ipod|mobile/i.test(source)) {
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
  return undefined;
}
