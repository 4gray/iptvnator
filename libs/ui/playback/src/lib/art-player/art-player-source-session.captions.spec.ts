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
 */
describe('ArtPlayerSourceSession caption preference without shared controls', () => {
    beforeAll(async () => {
        await initArtPlayerSourceSessionModule();
    });

    beforeEach(() => {
        resetArtPlayerSourceFixtures();
    });

    it('suppresses the HLS default subtitle track while the preference is off', () => {
        const { session, player, video } = createSession({
            sharedControls: false,
            showCaptions: () => false,
        });
        session.attach(player);
        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );

        const hls = hlsInstances[0];
        hls.subtitleTracks = [{ name: 'English' }];
        hls.subtitleTrack = 0;
        hls.subtitleDisplay = true;
        hls.emit(MockHls.Events.SUBTITLE_TRACKS_UPDATED);

        expect(hls.subtitleDisplay).toBe(false);
        session.destroy();
    });

    it('keeps HLS subtitles displayed while the preference is on', () => {
        const { session, player, video } = createSession({
            sharedControls: false,
            showCaptions: () => true,
        });
        session.attach(player);
        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );

        const hls = hlsInstances[0];
        hls.subtitleTracks = [{ name: 'English' }];
        hls.subtitleTrack = 0;
        hls.subtitleDisplay = true;
        hls.emit(MockHls.Events.SUBTITLE_TRACKS_UPDATED);

        expect(hls.subtitleDisplay).toBe(true);
        session.destroy();
    });

    it('re-applies the preference to a replacement source', () => {
        const preference = { value: false };
        const { session, player, video } = createSession({
            sharedControls: false,
            showCaptions: () => preference.value,
        });
        session.attach(player);
        session.customType['m3u8']?.(
            video,
            'https://example.test/first.m3u8',
            player
        );
        session.customType['m3u8']?.(
            video,
            'https://example.test/second.m3u8',
            player
        );

        const replacement = hlsInstances[1];
        replacement.subtitleTracks = [{ name: 'English' }];
        replacement.subtitleTrack = 0;
        replacement.subtitleDisplay = true;
        replacement.emit(MockHls.Events.SUBTITLE_TRACKS_UPDATED);

        expect(replacement.subtitleDisplay).toBe(false);
        session.destroy();
    });

    it('stops touching the engine after the session is destroyed', () => {
        const { session, player, video } = createSession({
            sharedControls: false,
            showCaptions: () => false,
        });
        session.attach(player);
        session.customType['m3u8']?.(
            video,
            'https://example.test/live.m3u8',
            player
        );
        const hls = hlsInstances[0];

        session.destroy();
        hls.subtitleDisplay = true;
        hls.emit(MockHls.Events.SUBTITLE_TRACKS_UPDATED);

        expect(hls.subtitleDisplay).toBe(true);
    });
});
