import {
    PlaybackDiagnosticCode,
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    classifyNativePlaybackIssue,
    createPlaybackSourceMetadata,
    getLikelyBrowserUnsupportedCodecLabels,
    getPlaybackMediaExtensionFromUrl,
} from './playback-diagnostics.util';

describe('playback diagnostics', () => {
    it('classifies HLS incompatible codec errors as unsupported codec fallbacks', () => {
        const issue = classifyHlsPlaybackIssue(
            {
                type: 'mediaError',
                details: 'manifestIncompatibleCodecsError',
                fatal: true,
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/index.m3u8',
                mimeType: 'application/x-mpegURL',
                player: 'videojs',
                audioCodecs: ['ac-3'],
                videoCodecs: ['avc1.64001f'],
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnsupportedCodec);
        expect(issue.externalFallbackRecommended).toBe(true);
        expect(issue.audioCodecs).toEqual(['ac-3']);
        expect(issue.videoCodecs).toEqual(['avc1.64001f']);
    });

    it('classifies HLS buffer codec errors as unsupported codec fallbacks', () => {
        const issue = classifyHlsPlaybackIssue(
            {
                type: 'mediaError',
                details: 'bufferIncompatibleCodecsError',
                fatal: true,
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/index.m3u8',
                player: 'html5',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnsupportedCodec);
        expect(issue.externalFallbackRecommended).toBe(true);
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

    it('does not classify MPEG-TS MIME-only failures as unsupported containers', () => {
        const issue = classifyNativePlaybackIssue(
            { code: 4, message: 'source not supported' },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/stream',
                mimeType: 'video/mp2t',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.UnsupportedCodec);
        expect(issue.container).toBe('mp2t');
    });

    it('classifies HLS network errors without claiming codec incompatibility', () => {
        const issue = classifyHlsPlaybackIssue(
            {
                type: 'networkError',
                details: 'manifestLoadError',
                fatal: true,
            },
            createPlaybackSourceMetadata({
                url: 'https://example.com/live/index.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.NetworkError);
        expect(issue.externalFallbackRecommended).toBe(false);
    });

    it('does not treat provider-side blocked messages as browser access errors', () => {
        const issue = classifyHlsPlaybackIssue(
            {
                type: 'networkError',
                details: 'manifestLoadError Request blocked by rate limiter',
                fatal: true,
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live/index.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.NetworkError);
        expect(issue.externalFallbackRecommended).toBe(false);
    });

    it('keeps raw HLS error object context in diagnostic details', () => {
        const issue = classifyHlsPlaybackIssue(
            {
                type: 'networkError',
                details: 'manifestLoadError',
                fatal: true,
                error: {
                    context: 'xhr setup failed',
                    status: 0,
                },
            },
            createPlaybackSourceMetadata({
                url: 'https://provider.example/live/index.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.details).toContain('xhr setup failed');
        expect(issue.details).toContain('"status":0');
    });

    it('classifies HLS browser access blocks separately from provider network failures', () => {
        const issue = classifyHlsPlaybackIssue(
            {
                type: 'networkError',
                details:
                    'manifestLoadError Mixed Content: The page at https://app.example was loaded over HTTPS, but requested an insecure stream http://provider.example/live.m3u8. This request has been blocked.',
                fatal: true,
            },
            createPlaybackSourceMetadata({
                url: 'http://provider.example/live.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe('browser-access-error');
        expect(issue.externalFallbackRecommended).toBe(true);
    });

    it('classifies browser security policy blocks as browser access errors', () => {
        const issue = classifyHlsPlaybackIssue(
            {
                type: 'networkError',
                details:
                    'manifestLoadError Refused to connect because it violates the following Content Security Policy directive: "connect-src"',
                fatal: true,
            },
            createPlaybackSourceMetadata({
                url: 'http://provider.example/live.m3u8',
                player: 'videojs',
            })
        );

        expect(issue.code).toBe(PlaybackDiagnosticCode.BrowserAccessError);
        expect(issue.externalFallbackRecommended).toBe(true);
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
