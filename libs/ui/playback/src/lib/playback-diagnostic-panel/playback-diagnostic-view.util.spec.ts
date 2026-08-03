import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';
import {
    getDiagnosticCodecHint,
    getDiagnosticDescriptionKey,
    getDiagnosticDetails,
    getDiagnosticMeta,
    getDiagnosticTitleKey,
} from './playback-diagnostic-view.util';

describe('playback diagnostic view formatters', () => {
    const issue: PlaybackDiagnostic = {
        code: PlaybackDiagnosticCode.UnsupportedCodec,
        source: PlaybackDiagnosticSource.Native,
        sourceUrl: 'https://example.com/movie.mkv',
        container: 'matroska',
        mimeType: 'video/matroska',
        player: 'videojs',
        audioCodecs: ['ac-3'],
        videoCodecs: ['hvc1.1.6.L93.B0'],
        externalFallbackRecommended: true,
    };

    it('preserves existing title, metadata, codec and detail formatting', () => {
        expect(getDiagnosticTitleKey(issue)).toBe(
            'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CODEC.TITLE'
        );
        expect(getDiagnosticMeta(issue)).toBe('hvc1.1.6.L93.B0, ac-3');
        expect(getDiagnosticCodecHint(issue)).toBe('HEVC, AC-3');
        expect(getDiagnosticDetails(issue)).toEqual(
            expect.arrayContaining([
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_PLAYER',
                    value: 'Video.js',
                },
                {
                    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_SOURCE',
                    value: 'Native media element',
                },
            ])
        );
    });

    it('uses external recommendation presence for browser-access copy', () => {
        const browserIssue: PlaybackDiagnostic = {
            ...issue,
            code: PlaybackDiagnosticCode.BrowserAccessError,
        };

        expect(getDiagnosticDescriptionKey(browserIssue, true)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.DESCRIPTION'
        );
        expect(getDiagnosticDescriptionKey(browserIssue, false)).toBe(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.PWA_DESCRIPTION'
        );
    });
});
