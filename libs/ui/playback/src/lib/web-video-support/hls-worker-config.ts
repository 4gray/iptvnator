import type { HlsConfig } from 'hls.js';

/**
 * hls.js's ESM build demuxes MPEG-TS off the UI thread only when it is given
 * its worker script (copied to `assets/` by apps/web/project.json); without it
 * every segment is transmuxed on the main thread. hls.js resolves `workerPath`
 * against `location.href`, which is a deep route here, so the URL is made
 * absolute from `<base href>`. Non-http origins (Electron's file://) keep the
 * inline path.
 */
export function hlsWorkerConfig(
    doc: Pick<Document, 'baseURI'> | undefined = globalThis.document,
    protocol: string | undefined = globalThis.location?.protocol
): Partial<HlsConfig> {
    if (!doc || !protocol || !/^https?:$/.test(protocol)) {
        return {};
    }
    return { workerPath: new URL('assets/hls.worker.js', doc.baseURI).href };
}
