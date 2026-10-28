import Hls, { type HlsConfig } from 'hls.js';

/** Opt-out: localStorage['iptvnator.hlsInlineTransmux'] = '1' keeps the
 *  transmuxer on the UI thread. Added in October 2026; remove it two releases
 *  later if nobody needs it. */
const INLINE_TRANSMUX_KEY = 'iptvnator.hlsInlineTransmux';

/**
 * hls.js's ESM build demuxes MPEG-TS off the UI thread only when it is given
 * its worker script (copied to `assets/` by apps/web/project.json); without it
 * every segment is transmuxed on the main thread. hls.js resolves `workerPath`
 * against `location.href`, which is a deep route here, so the URL is made
 * absolute from `<base href>`. It carries the bundled hls.js version: the
 * worker speaks a private protocol with the main bundle, and a worker cached
 * from an older release would load fine and then be ignored. Non-http origins
 * (Electron's file://) keep the inline path.
 */
export function hlsWorkerConfig(
    doc: Pick<Document, 'baseURI'> | undefined = globalThis.document,
    protocol: string | undefined = globalThis.location?.protocol,
    storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()
): Partial<HlsConfig> {
    if (!doc || !protocol || !/^https?:$/.test(protocol)) {
        return {};
    }
    if (storage?.getItem(INLINE_TRANSMUX_KEY) === '1') {
        return {};
    }
    const url = new URL('assets/hls.worker.js', doc.baseURI);
    url.searchParams.set('v', Hls.version);
    return { workerPath: url.href };
}

function safeLocalStorage(): Pick<Storage, 'getItem'> | undefined {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined; // storage blocked: keep the default
    }
}
