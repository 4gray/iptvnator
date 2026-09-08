import {
    collectPlaybackCodecs,
    getPlaybackDrmSystem,
    SHAKA_REQUEST_TYPE,
    type PlaybackDrmSystem,
} from '@iptvnator/playback/util';
import type {
    ShakaNetworkingEngineLike,
    ShakaResponseFilter,
} from './shaka-module.types';

const DASH_NAMESPACE = 'urn:mpeg:dash:schema:mpd:2011';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

/** Observes existing responses only; owns no requests, URLs, keys or XML. */
export class ShakaManifestMetadata {
    private active = true;
    private codecs = collectPlaybackCodecs([]);
    private drmSystems: PlaybackDrmSystem[] = [];
    private readonly configuredSystem: PlaybackDrmSystem | undefined;

    constructor(
        private readonly network: ShakaNetworkingEngineLike | null,
        licenseType?: string
    ) {
        this.configuredSystem = getPlaybackDrmSystem(licenseType);
        network?.registerResponseFilter(this.onResponse);
    }

    read() {
        return {
            ...this.codecs,
            drmSystems: [
                ...new Set([
                    ...this.drmSystems,
                    ...(this.configuredSystem ? [this.configuredSystem] : []),
                ]),
            ],
        };
    }

    destroy(): void {
        this.active = false;
        this.network?.unregisterResponseFilter(this.onResponse);
    }

    private readonly onResponse: ShakaResponseFilter = (type, response) => {
        if (!this.active || type !== SHAKA_REQUEST_TYPE.MANIFEST) return;
        try {
            if (response.data.byteLength > MAX_MANIFEST_BYTES) return;
            const xml = new TextDecoder().decode(response.data);
            if (/<!DOCTYPE/i.test(xml)) return;
            const document = new DOMParser().parseFromString(
                xml,
                'application/xml'
            );
            if (
                document.getElementsByTagName('parsererror').length ||
                document.documentElement.localName !== 'MPD' ||
                document.documentElement.namespaceURI !== DASH_NAMESPACE
            )
                return;

            const elements: Element[] = [];
            for (const name of ['AdaptationSet', 'Representation']) {
                elements.push(
                    ...Array.from(
                        document.getElementsByTagNameNS(DASH_NAMESPACE, name)
                    ).slice(0, 256)
                );
            }
            this.codecs = collectPlaybackCodecs(
                elements.map((element) => ({
                    audioCodec: element.getAttribute('codecs'),
                    videoCodec: element.getAttribute('codecs'),
                }))
            );
            this.drmSystems = [
                ...new Set(
                    Array.from(
                        document.getElementsByTagNameNS(
                            DASH_NAMESPACE,
                            'ContentProtection'
                        )
                    )
                        .slice(0, 256)
                        .map((element) =>
                            getPlaybackDrmSystem(
                                element.getAttribute('schemeIdUri')
                            )
                        )
                        .filter(
                            (system): system is PlaybackDrmSystem =>
                                system !== undefined
                        )
                ),
            ];
        } catch {
            // Metadata is optional. Never turn inspection failure into a
            // network-filter failure or interfere with Shaka's own parser.
        }
    };
}
