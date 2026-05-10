import {
    PlaybackDiagnosticCode,
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    classifyNativePlaybackIssue,
    createPlaybackSourceMetadata,
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
});
