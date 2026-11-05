import {
    normalizeXtreamServerUrl,
    isStalkerAuthFailureResponse,
} from '@iptvnator/shared/interfaces';
import { Source } from '@iptvnator/tv/util';
export interface DirectProbeResult {
    catalog: string;
    media: string;
}
async function deadline<T>(
    work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 6000);
    try {
        return await work(abort.signal);
    } finally {
        clearTimeout(timer);
    }
}
/** Explicit, independent diagnostics. Never changes the selected transport. */
export async function probeDirect(
    source: Source,
    mediaUrl?: string
): Promise<DirectProbeResult> {
    const url = new URL(
        source.provider === 'xtream'
            ? `${normalizeXtreamServerUrl(source.url)}/player_api.php`
            : (source.endpoint ?? source.url)
    );
    if (source.provider === 'xtream') {
        url.searchParams.set('action', 'get_live_categories');
        url.searchParams.set('username', source.username ?? '');
        url.searchParams.set('password', source.password ?? '');
    }
    if (source.provider === 'stalker') {
        url.searchParams.set('type', 'itv');
        url.searchParams.set('action', 'get_genres');
        url.searchParams.set('JsHttpRequest', '1-xml');
    }
    const catalog = deadline(async (signal) => {
        try {
            const response = await fetch(url.href, {
                signal,
                credentials: 'omit',
            });
            if (!response.ok)
                return `Direct catalog refused (${response.status}).`;
            const body = await response.text();
            if (source.provider === 'm3u')
                return body.trim().startsWith('#EXTM3U')
                    ? 'Playlist is directly readable from this browser.'
                    : 'Direct response is not an M3U playlist.';
            let payload: unknown;
            try {
                payload = JSON.parse(body);
            } catch {
                payload = body;
            }
            if (isStalkerAuthFailureResponse(payload))
                return 'Portal requires MAG/session headers; direct browser catalog is unavailable.';
            return Array.isArray(payload) ||
                (payload && typeof payload === 'object' && 'js' in payload)
                ? 'Catalog endpoint is directly readable from this browser.'
                : 'Direct endpoint returned an unsupported response.';
        } catch {
            return 'Direct catalog could not be read (CORS, network, TLS or timeout). Backend remains selected.';
        }
    });
    const media = mediaUrl
        ? deadline(async (signal) => {
              try {
                  const response = await fetch(mediaUrl, {
                      method: 'HEAD',
                      signal,
                      credentials: 'omit',
                  });
                  return response.ok
                      ? 'Direct media HTTP headers are reachable. Native decoding, audio and seeking still need a device playback test.'
                      : `Direct media headers refused (${response.status}); a provider-compatible media relay may be required.`;
              } catch {
                  return 'Direct media headers could not be read. CORS failure does not establish whether native video playback works.';
              }
          })
        : Promise.resolve(
              'Start a stream first to check its direct media address.'
          );
    const [catalogResult, mediaResult] = await Promise.all([catalog, media]);
    return { catalog: catalogResult, media: mediaResult };
}
