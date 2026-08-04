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

    describe.each([
        {
            diagnostic: 'browser access',
            code: PlaybackDiagnosticCode.BrowserAccessError,
            desktopKey:
                'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.DESCRIPTION',
            pwaKey: 'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.PWA_DESCRIPTION',
        },
        {
            diagnostic: 'unsupported codec',
            code: PlaybackDiagnosticCode.UnsupportedCodec,
            desktopKey: 'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CODEC.DESCRIPTION',
            pwaKey: 'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CODEC.DESCRIPTION',
        },
        {
            diagnostic: 'unsupported container',
            code: PlaybackDiagnosticCode.UnsupportedContainer,
            desktopKey:
                'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CONTAINER.DESCRIPTION',
            pwaKey:
                'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CONTAINER.DESCRIPTION',
        },
        {
            diagnostic: 'media decode',
            code: PlaybackDiagnosticCode.MediaDecodeError,
            desktopKey: 'PLAYBACK_DIAGNOSTICS.MEDIA_DECODE_ERROR.DESCRIPTION',
            pwaKey: 'PLAYBACK_DIAGNOSTICS.MEDIA_DECODE_ERROR.DESCRIPTION',
        },
    ])('$diagnostic description', ({ code, desktopKey, pwaKey }) => {
        const diagnosticIssue: PlaybackDiagnostic = { ...issue, code };

        it.each([
            {
                runtime: 'desktop',
                supportsManagedExternalPlayers: true,
                expected: desktopKey,
            },
            {
                runtime: 'PWA',
                supportsManagedExternalPlayers: false,
                expected: pwaKey,
            },
        ])('preserves transferable $runtime copy', ({
            supportsManagedExternalPlayers,
            expected,
        }) => {
            expect(
                getDiagnosticDescriptionKey(
                    diagnosticIssue,
                    supportsManagedExternalPlayers,
                    true
                )
            ).toBe(expected);
        });

        it.each([
            ['desktop', true],
            ['PWA', false],
        ])(
            'uses neutral protected copy in the %s runtime',
            (_runtime, supportsManagedExternalPlayers) => {
                expect(
                    getDiagnosticDescriptionKey(
                        diagnosticIssue,
                        supportsManagedExternalPlayers,
                        false
                    )
                ).toBe('PLAYBACK_DIAGNOSTICS.UNTRANSFERABLE_DESCRIPTION');
            }
        );
    });

    it.each([
        [
            'network',
            PlaybackDiagnosticCode.NetworkError,
            'PLAYBACK_DIAGNOSTICS.NETWORK_ERROR.DESCRIPTION',
        ],
        [
            'unknown',
            PlaybackDiagnosticCode.UnknownPlaybackError,
            'PLAYBACK_DIAGNOSTICS.UNKNOWN_PLAYBACK_ERROR.DESCRIPTION',
        ],
        [
            'DRM or encryption',
            PlaybackDiagnosticCode.DrmOrEncryption,
            'PLAYBACK_DIAGNOSTICS.DRM_OR_ENCRYPTION.DESCRIPTION',
        ],
    ])('preserves neutral %s copy for protected playback', (_label, code, expected) => {
        expect(
            getDiagnosticDescriptionKey({ ...issue, code }, true, false)
        ).toBe(expected);
    });
});
