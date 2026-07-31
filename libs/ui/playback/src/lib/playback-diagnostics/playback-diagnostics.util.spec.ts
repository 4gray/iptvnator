import { ErrorDetails, ErrorTypes } from 'hls.js';
import {
    PlaybackDiagnosticCode,
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    classifyNativePlaybackIssue,
    createPlaybackSourceMetadata,
    getLikelyBrowserUnsupportedCodecLabels,
    getPlaybackMediaExtensionFromUrl,
} from './playback-diagnostics.util';

interface StructuredHlsEvidenceInput {
    readonly engineType: string;
    readonly engineDetails: string;
    readonly disposition: string;
    readonly stage: string;
    readonly failure: string;
    readonly httpStatus?: number;
}

function classifyStructuredHlsPlaybackIssue(
    evidence: StructuredHlsEvidenceInput,
    metadata: Parameters<typeof classifyHlsPlaybackIssue>[1]
): ReturnType<typeof classifyHlsPlaybackIssue> {
    return classifyHlsPlaybackIssue(evidence as never, metadata);
}

describe('playback diagnostics', () => {
    it('classifies HLS incompatible codec errors as unsupported codec fallbacks', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: ErrorTypes.MEDIA_ERROR,
                engineDetails:
                    ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR,
                disposition: 'fatal',
                stage: 'manifest',
                failure: 'unknown',
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/index.m3u8',
                mimeType: 'application/x-mpegURL',
                player: 'videojs',
                audioCodecs: ['ac-3'],
                videoCodecs: ['avc1.64001f'],
            })
        );

        expect(issue?.code).toBe(PlaybackDiagnosticCode.UnsupportedCodec);
        expect(issue?.externalFallbackRecommended).toBe(true);
        expect(issue?.audioCodecs).toEqual(['ac-3']);
        expect(issue?.videoCodecs).toEqual(['avc1.64001f']);
    });

    it('classifies HLS buffer codec errors as unsupported codec fallbacks', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: ErrorTypes.MEDIA_ERROR,
                engineDetails:
                    ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR,
                disposition: 'fatal',
                stage: 'media',
                failure: 'unknown',
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/index.m3u8',
                player: 'html5',
            })
        );

        expect(issue?.code).toBe(PlaybackDiagnosticCode.UnsupportedCodec);
        expect(issue?.externalFallbackRecommended).toBe(true);
    });

    it('classifies native decode and unsupported source errors without using network wording', () => {
        const decodeIssue = classifyNativePlaybackIssue(
            { code: 3, message: 'decode failed' },
            createPlaybackSourceMetadata({
                url: 'https://example.com/movie.mp4',
                mimeType: 'video/mp4',
                player: 'artplayer',
            })
        );
        const unsupportedSourceIssue = classifyNativePlaybackIssue(
            { code: 4, message: 'source not supported' },
            createPlaybackSourceMetadata({
                url: 'https://example.com/movie.mkv',
                mimeType: 'video/matroska',
                player: 'artplayer',
            })
        );

        expect(decodeIssue.code).toBe(PlaybackDiagnosticCode.MediaDecodeError);
        expect(decodeIssue.externalFallbackRecommended).toBe(true);
        expect(unsupportedSourceIssue.code).toBe(
            PlaybackDiagnosticCode.UnsupportedContainer
        );
        expect(unsupportedSourceIssue.externalFallbackRecommended).toBe(true);
    });

    it('classifies MIME-only unsupported containers as container diagnostics', () => {
        const issue = classifyNativePlaybackIssue(
            { code: 4, message: 'source not supported' },
            createPlaybackSourceMetadata({
                url: 'https://example.com/archive/stream',
                mimeType: 'video/x-msvideo',
                player: 'html5',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnsupportedContainer);
        expect(issue.container).toBe('x-msvideo');
    });

    it('keeps MPEG-TS MIME-only source failures unknown without codec evidence', () => {
        const issue = classifyNativePlaybackIssue(
            { code: 4, message: 'source not supported' },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/stream',
                mimeType: 'video/mp2t',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
        expect(issue.container).toBe('mp2t');
        expect(issue.externalFallbackRecommended).toBe(false);
    });

    it('classifies native HTTP source failures from a safe status and error type', () => {
        const issue = classifyNativePlaybackIssue(
            {
                code: 4,
                message: 'source not supported',
                status: 404,
                metadata: { errorType: 'networkrequestfailed' },
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/missing.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.NetworkError);
        expect(issue.httpStatus).toBe(404);
        expect(issue.nativeErrorType).toBe('networkrequestfailed');
        expect(issue.externalFallbackRecommended).toBe(false);
    });

    it('keeps native code four HLS source failures unknown without status or container evidence', () => {
        const issue = classifyNativePlaybackIssue(
            { code: 4, message: 'source not supported' },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/missing.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
        expect(issue.externalFallbackRecommended).toBe(false);
        expect(issue.httpStatus).toBeUndefined();
    });

    it('does not retain unsafe native status or metadata error types', () => {
        const issue = classifyNativePlaybackIssue(
            {
                code: 4,
                message: 'source not supported',
                status: 0,
                metadata: { errorType: 'request failed: token=secret value' },
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/missing.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
        expect(issue.httpStatus).toBeUndefined();
        expect(issue.nativeErrorType).toBeUndefined();
        expect(issue.externalFallbackRecommended).toBe(false);
    });

    it.each([
        { status: 399, accepted: false },
        { status: 400, accepted: true },
        { status: 599, accepted: true },
        { status: 600, accepted: false },
        { status: 404.5, accepted: false },
    ])('accepts native HTTP status $status only when it is a 4xx or 5xx integer', ({
        status,
        accepted,
    }) => {
        const issue = classifyNativePlaybackIssue(
            { code: 4, status },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/missing.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(
            accepted
                ? PlaybackDiagnosticCode.NetworkError
                : PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issue.httpStatus).toBe(accepted ? status : undefined);
    });

    it.each([
        { length: 128, accepted: true },
        { length: 129, accepted: false },
    ])('retains native error type identifiers up to $length characters', ({
        length,
        accepted,
    }) => {
        const errorType = 'a'.repeat(length);
        const issue = classifyNativePlaybackIssue(
            { code: 4, metadata: { errorType } },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/missing.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
        expect(issue.nativeErrorType).toBe(accepted ? errorType : undefined);
    });

    it('classifies HLS network errors without claiming codec incompatibility', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: ErrorTypes.NETWORK_ERROR,
                engineDetails: ErrorDetails.MANIFEST_LOAD_ERROR,
                disposition: 'fatal',
                stage: 'manifest',
                failure: 'network',
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/index.m3u8',
                player: 'videojs',
            })
        );

        expect(issue?.code).toBe(PlaybackDiagnosticCode.NetworkError);
        expect(issue?.externalFallbackRecommended).toBe(false);
    });

    it('retains structured HLS HTTP and stage evidence', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: ErrorTypes.NETWORK_ERROR,
                engineDetails: ErrorDetails.MANIFEST_LOAD_ERROR,
                disposition: 'fatal',
                stage: 'manifest',
                failure: 'http',
                httpStatus: 404,
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/index.m3u8',
                player: 'videojs',
            })
        );

        expect(issue).toEqual(
            expect.objectContaining({
                code: PlaybackDiagnosticCode.NetworkError,
                httpStatus: 404,
                hls: expect.objectContaining({
                    engineType: ErrorTypes.NETWORK_ERROR,
                    engineDetails: ErrorDetails.MANIFEST_LOAD_ERROR,
                    disposition: 'fatal',
                    stage: 'manifest',
                    failure: 'http',
                    httpStatus: 404,
                }),
                externalFallbackRecommended: false,
            })
        );
    });

    it('does not create terminal diagnostics for recoverable HLS events', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: ErrorTypes.NETWORK_ERROR,
                engineDetails: ErrorDetails.FRAG_LOAD_ERROR,
                disposition: 'recoverable',
                stage: 'segment',
                failure: 'network',
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live/index.m3u8',
                player: 'videojs',
            })
        );

        expect(issue).toBeNull();
    });

    it('keeps status-zero HLS failures as network evidence rather than guessing access', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: ErrorTypes.NETWORK_ERROR,
                engineDetails: ErrorDetails.MANIFEST_LOAD_ERROR,
                disposition: 'fatal',
                stage: 'manifest',
                failure: 'network',
            },
            createPlaybackSourceMetadata({
                url: 'http://provider.example/live.m3u8',
                player: 'videojs',
            })
        );

        expect(issue?.code).toBe(PlaybackDiagnosticCode.NetworkError);
        expect(issue?.httpStatus).toBeUndefined();
        expect(issue?.externalFallbackRecommended).toBe(false);
    });

    it('classifies exact HLS decrypt evidence as DRM or encryption', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: ErrorTypes.MEDIA_ERROR,
                engineDetails: ErrorDetails.FRAG_DECRYPT_ERROR,
                disposition: 'fatal',
                stage: 'segment',
                failure: 'unknown',
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live.m3u8',
                player: 'html5',
            })
        );

        expect(issue?.code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        expect(issue?.externalFallbackRecommended).toBe(true);
    });

    it('classifies exact HLS key load failures as network errors', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: ErrorTypes.NETWORK_ERROR,
                engineDetails: ErrorDetails.KEY_LOAD_ERROR,
                disposition: 'fatal',
                stage: 'key',
                failure: 'network',
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live.m3u8',
                player: 'artplayer',
            })
        );

        expect(issue?.code).toBe(PlaybackDiagnosticCode.NetworkError);
        expect(issue?.externalFallbackRecommended).toBe(false);
    });

    it.each([ErrorTypes.MEDIA_ERROR, ErrorTypes.MUX_ERROR])(
        'classifies exact HLS %s evidence as a media decode error',
        (engineType) => {
            const issue = classifyStructuredHlsPlaybackIssue(
                {
                    engineType,
                    engineDetails: ErrorDetails.FRAG_PARSING_ERROR,
                    disposition: 'fatal',
                    stage: 'segment',
                    failure: 'unknown',
                },
                createPlaybackSourceMetadata({
                    url: 'https://provider.example/live.m3u8',
                    player: 'html5',
                })
            );

            expect(issue?.code).toBe(
                PlaybackDiagnosticCode.MediaDecodeError
            );
        }
    );

    it('keeps unknown structured HLS evidence unknown', () => {
        const issue = classifyStructuredHlsPlaybackIssue(
            {
                engineType: 'unknown',
                engineDetails: ErrorDetails.UNKNOWN,
                disposition: 'fatal',
                stage: 'unknown',
                failure: 'unknown',
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live.m3u8?codec=network',
                player: 'html5',
            })
        );

        expect(issue?.code).toBe(
            PlaybackDiagnosticCode.UnknownPlaybackError
        );
        expect(issue?.externalFallbackRecommended).toBe(false);
    });

    it('classifies native CORS failures as browser access errors', () => {
        const issue = classifyNativePlaybackIssue(
            {
                code: 2,
                message:
                    'Access to media at https://provider.example/live.m3u8 from origin app://iptvnator has been blocked by CORS policy: No Access-Control-Allow-Origin header is present.',
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live.m3u8',
                player: 'html5',
            })
        );

        expect(issue.code).toBe('browser-access-error');
        expect(issue.externalFallbackRecommended).toBe(true);
    });

    it('keeps opaque native network failures generic when the browser hides access details', () => {
        const issue = classifyNativePlaybackIssue(
            {
                code: 2,
                message: '',
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live.m3u8',
                player: 'html5',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.NetworkError);
        expect(issue.externalFallbackRecommended).toBe(false);
    });

    it('classifies mpegts browser fetch restrictions separately from generic network errors', () => {
        const issue = classifyMpegTsPlaybackIssue(
            {
                type: 'NetworkError',
                details:
                    'Fetch blocked by access-control policy while loading segment',
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live/channel.ts',
                mimeType: 'video/mp2t',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe('browser-access-error');
        expect(issue.externalFallbackRecommended).toBe(true);
    });

    it('classifies mpegts early EOF failures as fallback-actionable media errors', () => {
        const issue = classifyMpegTsPlaybackIssue(
            {
                type: 'NetworkError',
                details: 'UnrecoverableEarlyEof',
                info: { msg: 'Fetch stream meet Early-EOF' },
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/movie/123.ts',
                mimeType: 'video/mp2t',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.MediaDecodeError);
        expect(issue.externalFallbackRecommended).toBe(true);
        expect(issue.details).toContain('Early-EOF');
    });

    it('classifies mpegts codec errors as unsupported codec fallbacks', () => {
        const issue = classifyMpegTsPlaybackIssue(
            {
                type: 'MediaError',
                details: 'MediaCodecUnsupported',
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/channel.ts',
                mimeType: 'video/mp2t',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnsupportedCodec);
        expect(issue.externalFallbackRecommended).toBe(true);
    });

    it('prefers stream extension query metadata over web script path extensions', () => {
        const metadata = createPlaybackSourceMetadata({
            url: 'http://portal.example/play/live.php?stream=123&extension=ts',
            player: 'html5',
        });

        expect(metadata.extension).toBe('ts');
        expect(metadata.container).toBe('ts');
    });

    it('does not expose web script extensions as media containers', () => {
        const metadata = createPlaybackSourceMetadata({
            url: 'http://portal.example/play/live.php?stream=123',
            player: 'html5',
        });

        expect(metadata.extension).toBe('');
        expect(metadata.container).toBe('');
    });

    it('uses declared media query metadata without exposing web script extensions', () => {
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://portal.example/play/live.php?format=m3u8&stream=123'
            )
        ).toBe('m3u8');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://portal.example/play/live.php?container=m3u8&stream=123'
            )
        ).toBe('m3u8');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://portal.example/play/live.php?ext=ts&stream=123'
            )
        ).toBe('ts');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://portal.example/play/live.php?stream=123'
            )
        ).toBe('');
    });

    it('keeps trusted media path extensions ahead of generic query metadata', () => {
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://cdn.example/archive/movie.mp4?container=m3u8'
            )
        ).toBe('mp4');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://cdn.example/live/channel.m3u8?format=mp4'
            )
        ).toBe('m3u8');
    });

    it('keeps explicit extension query metadata ahead of trusted media path extensions', () => {
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://cdn.example/live/channel.ts?extension=m3u8'
            )
        ).toBe('m3u8');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://cdn.example/live/channel.m3u8?ext=ts'
            )
        ).toBe('ts');
    });

    it('does not infer media extensions from generic type/output query metadata', () => {
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://portal.example/play/live.php?type=m3u8&stream=123'
            )
        ).toBe('');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://portal.example/play/live.php?output=ts&stream=123'
            )
        ).toBe('');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://portal.example/play/live.php?format=mpv&stream=123'
            )
        ).toBe('');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://portal.example/play/live.mpv?stream=123'
            )
        ).toBe('');
    });

    it('detects codecs with limited Chromium browser-player support', () => {
        expect(
            getLikelyBrowserUnsupportedCodecLabels({
                audioCodecs: ['mp4a.40.2', 'ac-3', 'ec-3'],
                videoCodecs: ['avc1.64001f', 'hvc1.1.6.L93.B0'],
            })
        ).toEqual(['HEVC', 'AC-3', 'E-AC-3']);
    });
});
