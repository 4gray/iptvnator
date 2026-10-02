import {
    VideoPlayer,
    isWebVideoPlayer,
    playsDashInline,
    reportsPlaybackFailures,
} from './settings.interface';

describe('video player capability helpers', () => {
    const webPlayers = [
        VideoPlayer.VideoJs,
        VideoPlayer.Html5Player,
        VideoPlayer.ArtPlayer,
        VideoPlayer.Vidstack,
    ];

    it.each(Object.values(VideoPlayer))(
        'classifies %s as a web video player or not',
        (player) => {
            const expected = webPlayers.includes(player);
            expect(isWebVideoPlayer(player)).toBe(expected);
            // Only the in-app web engines raise playback diagnostics.
            expect(reportsPlaybackFailures(player)).toBe(expected);
        }
    );

    it.each([
        [VideoPlayer.Html5Player, true],
        [VideoPlayer.ArtPlayer, true],
        [VideoPlayer.Vidstack, true],
        [VideoPlayer.VideoJs, false],
        [VideoPlayer.EmbeddedMpv, false],
        [VideoPlayer.MPV, false],
        [VideoPlayer.VLC, false],
    ])('reports whether %s plays DASH through Shaka: %s', (player, expected) => {
        expect(playsDashInline(player)).toBe(expected);
    });

    it('treats a missing player as none of the above', () => {
        expect(isWebVideoPlayer(undefined)).toBe(false);
        expect(playsDashInline(null)).toBe(false);
    });
});
