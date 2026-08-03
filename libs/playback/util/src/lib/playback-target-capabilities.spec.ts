import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
} from './diagnostics/playback-diagnostics.model';
import {
    PlaybackEngineFamily,
    PlaybackSourceKind,
} from './playback-recommendation.model';
import {
    createPlaybackTargetCapabilities,
    getInlinePlaybackEngineFamily,
    resolvePlaybackSourceKind,
} from './playback-target-capabilities';

function diagnostic(
    overrides: Partial<PlaybackDiagnostic>
): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.UnknownPlaybackError,
        source: PlaybackDiagnosticSource.Source,
        sourceUrl: 'https://example.com/stream',
        container: '',
        audioCodecs: [],
        videoCodecs: [],
        externalFallbackRecommended: false,
        ...overrides,
    };
}

describe('playback target capabilities', () => {
    it.each([
        [
            PlaybackSourceKind.Hls,
            InlinePlaybackPlayer.VideoJs,
            PlaybackEngineFamily.Vhs,
        ],
        [
            PlaybackSourceKind.Hls,
            InlinePlaybackPlayer.Html5,
            PlaybackEngineFamily.HlsJs,
        ],
        [
            PlaybackSourceKind.Hls,
            InlinePlaybackPlayer.ArtPlayer,
            PlaybackEngineFamily.HlsJs,
        ],
        [
            PlaybackSourceKind.MpegTs,
            InlinePlaybackPlayer.VideoJs,
            PlaybackEngineFamily.MpegTsJs,
        ],
        [
            PlaybackSourceKind.MpegTs,
            InlinePlaybackPlayer.Html5,
            PlaybackEngineFamily.MpegTsJs,
        ],
        [
            PlaybackSourceKind.MpegTs,
            InlinePlaybackPlayer.ArtPlayer,
            PlaybackEngineFamily.MpegTsJs,
        ],
        [PlaybackSourceKind.Dash, InlinePlaybackPlayer.VideoJs, null],
        [
            PlaybackSourceKind.Dash,
            InlinePlaybackPlayer.Html5,
            PlaybackEngineFamily.Shaka,
        ],
        [
            PlaybackSourceKind.Dash,
            InlinePlaybackPlayer.ArtPlayer,
            PlaybackEngineFamily.Shaka,
        ],
        [
            PlaybackSourceKind.Native,
            InlinePlaybackPlayer.VideoJs,
            PlaybackEngineFamily.NativeMedia,
        ],
        [
            PlaybackSourceKind.Native,
            InlinePlaybackPlayer.Html5,
            PlaybackEngineFamily.NativeMedia,
        ],
        [
            PlaybackSourceKind.Native,
            InlinePlaybackPlayer.ArtPlayer,
            PlaybackEngineFamily.NativeMedia,
        ],
    ] as const)('maps %s on %s to %s', (sourceKind, target, expectedFamily) => {
        expect(getInlinePlaybackEngineFamily(sourceKind, target)).toBe(
            expectedFamily
        );
    });

    it.each([
        [PlaybackDiagnosticSource.Hls, {}, PlaybackSourceKind.Hls],
        [
            PlaybackDiagnosticSource.Vhs,
            { container: 'm3u8' },
            PlaybackSourceKind.Hls,
        ],
        [
            PlaybackDiagnosticSource.Source,
            { container: 'm3u' },
            PlaybackSourceKind.Hls,
        ],
        [
            PlaybackDiagnosticSource.Vhs,
            {
                mimeType: '  Application/Vnd.Apple.MPEGURL; charset=UTF-8  ',
            },
            PlaybackSourceKind.Hls,
        ],
        [
            PlaybackDiagnosticSource.Source,
            { mimeType: 'application/x-mpegurl' },
            PlaybackSourceKind.Hls,
        ],
        [
            PlaybackDiagnosticSource.Vhs,
            { mimeType: 'audio/x-mpegurl' },
            PlaybackSourceKind.Hls,
        ],
        [PlaybackDiagnosticSource.Shaka, {}, PlaybackSourceKind.Dash],
        [
            PlaybackDiagnosticSource.Source,
            { container: 'mpd' },
            PlaybackSourceKind.Dash,
        ],
        [
            PlaybackDiagnosticSource.Vhs,
            { container: 'mpd' },
            PlaybackSourceKind.Dash,
        ],
        [
            PlaybackDiagnosticSource.Source,
            { mimeType: ' Application/Dash+XML; profile=live ' },
            PlaybackSourceKind.Dash,
        ],
        [PlaybackDiagnosticSource.MpegTs, {}, PlaybackSourceKind.MpegTs],
        [PlaybackDiagnosticSource.Native, {}, PlaybackSourceKind.Native],
    ] as const)(
        'resolves %s diagnostics with %o as %s',
        (source, metadata, expectedKind) => {
            expect(
                resolvePlaybackSourceKind(diagnostic({ source, ...metadata }))
            ).toBe(expectedKind);
        }
    );

    it.each([
        diagnostic({ source: PlaybackDiagnosticSource.Source }),
        diagnostic({
            source: PlaybackDiagnosticSource.Source,
            container: 'mp4',
            mimeType: 'video/mp4',
        }),
        diagnostic({
            source: PlaybackDiagnosticSource.Vhs,
            container: 'mpd',
            mimeType: 'application/vnd.apple.mpegurl',
        }),
        diagnostic({
            source: PlaybackDiagnosticSource.Source,
            container: 'm3u8',
            mimeType: 'application/dash+xml',
        }),
        diagnostic({
            source: PlaybackDiagnosticSource.Vhs,
            mimeType: 'application/not-mpegurl',
        }),
    ])('keeps insufficient or contradictory evidence unknown', (issue) => {
        expect(resolvePlaybackSourceKind(issue)).toBe(
            PlaybackSourceKind.Unknown
        );
    });

    it.each([
        [
            PlaybackDiagnosticSource.Hls,
            { container: 'mpd', mimeType: 'application/dash+xml' },
            PlaybackSourceKind.Hls,
        ],
        [
            PlaybackDiagnosticSource.MpegTs,
            { container: 'mpd', mimeType: 'application/dash+xml' },
            PlaybackSourceKind.MpegTs,
        ],
        [
            PlaybackDiagnosticSource.Shaka,
            {
                container: 'm3u8',
                mimeType: 'application/vnd.apple.mpegurl',
            },
            PlaybackSourceKind.Dash,
        ],
        [
            PlaybackDiagnosticSource.Native,
            {
                container: 'm3u8',
                mimeType: 'application/vnd.apple.mpegurl',
            },
            PlaybackSourceKind.Native,
        ],
    ] as const)(
        'treats engine-specific %s source evidence as authoritative',
        (source, metadata, expectedKind) => {
            expect(
                resolvePlaybackSourceKind(diagnostic({ source, ...metadata }))
            ).toBe(expectedKind);
        }
    );

    it('creates capabilities in canonical order', () => {
        expect(
            createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Hls,
                managedExternalPlayersAvailable: true,
            })
        ).toEqual([
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.VideoJs,
                available: true,
                engineFamily: PlaybackEngineFamily.Vhs,
            },
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.Html5,
                available: true,
                engineFamily: PlaybackEngineFamily.HlsJs,
            },
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.ArtPlayer,
                available: true,
                engineFamily: PlaybackEngineFamily.HlsJs,
            },
            { kind: 'external', target: 'mpv', available: true },
            { kind: 'external', target: 'vlc', available: true },
        ]);
    });

    it('marks Video.js unavailable for DASH and mirrors external availability', () => {
        expect(
            createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Dash,
                managedExternalPlayersAvailable: false,
            })
        ).toEqual([
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.VideoJs,
                available: false,
                engineFamily: null,
            },
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.Html5,
                available: true,
                engineFamily: PlaybackEngineFamily.Shaka,
            },
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.ArtPlayer,
                available: true,
                engineFamily: PlaybackEngineFamily.Shaka,
            },
            { kind: 'external', target: 'mpv', available: false },
            { kind: 'external', target: 'vlc', available: false },
        ]);
    });

    it('fails closed for unknown inline source capabilities', () => {
        expect(
            createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Unknown,
                managedExternalPlayersAvailable: true,
            })
        ).toEqual([
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.VideoJs,
                available: false,
                engineFamily: null,
            },
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.Html5,
                available: false,
                engineFamily: null,
            },
            {
                kind: 'inline',
                target: InlinePlaybackPlayer.ArtPlayer,
                available: false,
                engineFamily: null,
            },
            { kind: 'external', target: 'mpv', available: true },
            { kind: 'external', target: 'vlc', available: true },
        ]);
    });
});
