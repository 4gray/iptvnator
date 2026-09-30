import Hls, { type ErrorData, type ManifestParsedData } from 'hls.js';
import {
    type PlaybackDiagnostic,
    classifyHlsPlaybackIssue,
    classifyUnsupportedHlsManifestCodecs,
    collectPlaybackCodecs,
    createHlsPlaybackEvidence,
} from '@iptvnator/playback/util';
import { isBrowserMediaTypeSupported } from '../web-video-support/browser-media-type-support';
import { createVidstackSourceMetadata } from './vidstack-player-setup';

const HLS_MIME_TYPE = 'application/x-mpegURL';

export interface VidstackHlsObserverConfig {
    url: string;
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void;
}

/**
 * Playback diagnostics for the hls.js instance of Vidstack's HLS provider.
 *
 * The observer only listens: Vidstack creates, recovers and destroys the
 * instance, so releasing it removes the exact listeners and nothing else.
 */
export class VidstackHlsObserver {
    private hls: Hls | null = null;

    private readonly handleManifestParsed = (
        _event: unknown,
        data: ManifestParsedData
    ): void => {
        const metadata = createVidstackSourceMetadata(
            this.config.url,
            HLS_MIME_TYPE,
            data.levels
                .map((level) => level.audioCodec)
                .filter((codec): codec is string => Boolean(codec)),
            data.levels
                .map((level) => level.videoCodec)
                .filter((codec): codec is string => Boolean(codec))
        );
        const issue = classifyUnsupportedHlsManifestCodecs(
            metadata,
            isBrowserMediaTypeSupported
        );
        if (issue) {
            this.config.emitPlaybackIssue(issue);
        }
    };

    private readonly handleError = (_event: unknown, data: ErrorData): void => {
        const issue = classifyHlsPlaybackIssue(
            createHlsPlaybackEvidence(data),
            {
                ...createVidstackSourceMetadata(this.config.url, HLS_MIME_TYPE),
                ...collectPlaybackCodecs(this.hls?.levels ?? []),
            }
        );
        if (issue) {
            this.config.emitPlaybackIssue(issue);
        }
    };

    constructor(private readonly config: VidstackHlsObserverConfig) {}

    observe(hls: Hls): void {
        if (this.hls === hls) {
            return;
        }
        this.release();
        this.hls = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, this.handleManifestParsed);
        hls.on(Hls.Events.ERROR, this.handleError);
    }

    release(): void {
        const hls = this.hls;
        if (!hls) {
            return;
        }
        this.hls = null;
        hls.off(Hls.Events.MANIFEST_PARSED, this.handleManifestParsed);
        hls.off(Hls.Events.ERROR, this.handleError);
    }
}
