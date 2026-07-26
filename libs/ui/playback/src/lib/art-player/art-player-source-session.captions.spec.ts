import {
    MockHls,
    createSession,
    hlsInstances,
    initArtPlayerSourceSessionModule,
    resetArtPlayerSourceFixtures,
} from './art-player-source-session.spec-fixtures';

/**
 * Regression coverage for #1155: with ArtPlayer's own chrome (shared controls
 * off, the shipping default) the `showCaptions` preference reached no engine at
 * all, so an HLS rendition flagged DEFAULT/AUTOSELECT kept subtitles on screen.
 *
 * The preference seeds each source here rather than staying authoritative, so
 * the engine's caption menu still works once playback is running.
 */
describe('ArtPlayerSourceSession caption preference without shared controls', () => {
    beforeAll(async () => {
        await initArtPlayerSourceSessionModule();
    });

    beforeEach(() => {
        resetArtPlayerSourceFixtures();
    });

    it('deselects the HLS default subtitle track while the preference is off', () => {
        const { session, player, video } = startHls(() => false);

        const hls = selectDefaultSubtitleTrack(hlsInstances[0]);

        expect(hls.subtitleTrack).toBe(-1);
        // Display stays enabled: hls.js applies `subtitleDisplay` to whatever
        // the vendor caption menu picks, so suppressing it would make the menu
        // inert while the preference is off.
        expect(hls.subtitleDisplay).toBe(true);
        expect(player.video).toBe(video);
        session.destroy();
    });

    it('keeps a selection made after playback started', () => {
        const { session, video } = startHls(() => false);
        const hls = selectDefaultSubtitleTrack(hlsInstances[0]);
        expect(hls.subtitleTrack).toBe(-1);

        video.dispatchEvent(new Event('playing'));
        hls.subtitleTrack = 0;
        hls.emit(MockHls.Events.SUBTITLE_TRACK_SWITCH);

        expect(hls.subtitleTrack).toBe(0);
        session.destroy();
    });

    it('keeps HLS subtitles selected while the preference is on', () => {
        const { session } = startHls(() => true);

        const hls = selectDefaultSubtitleTrack(hlsInstances[0]);

        expect(hls.subtitleTrack).toBe(0);
        session.destroy();
    });

    it('re-seeds the preference for a replacement source', () => {
        const { session, player, video } = startHls(() => false);
        video.dispatchEvent(new Event('playing'));

        session.customType['m3u8']?.(
            video,
            'https://example.test/second.m3u8',
            player
        );
        const replacement = selectDefaultSubtitleTrack(hlsInstances[1]);

        expect(replacement.subtitleTrack).toBe(-1);
        session.destroy();
    });

    it('stops touching the engine after the session is destroyed', () => {
        const { session } = startHls(() => false);
        const hls = hlsInstances[0];

        session.destroy();
        const untouched = selectDefaultSubtitleTrack(hls);

        expect(untouched.subtitleTrack).toBe(0);
    });

    function startHls(showCaptions: () => boolean) {
        const { session, player, video } = createSession({
            sharedControls: false,
            showCaptions,
        });
        session.attach(player);
        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );
        return { session, player, video };
    }

    /** Mimics hls.js auto-selecting a DEFAULT/AUTOSELECT rendition. */
    function selectDefaultSubtitleTrack(hls: MockHls): MockHls {
        hls.subtitleTracks = [{ name: 'English' }];
        hls.subtitleDisplay = true;
        hls.subtitleTrack = 0;
        hls.emit(MockHls.Events.SUBTITLE_TRACKS_UPDATED);
        return hls;
    }
});
