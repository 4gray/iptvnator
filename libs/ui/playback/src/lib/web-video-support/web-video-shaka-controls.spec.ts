import { InlinePlaybackPlayer } from '@iptvnator/playback/util';
import {
    createFakeShakaEnvironment,
    flushShakaMicrotasks as flush,
} from '../shaka-engine/shaka-player-test-double';
import { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import { WebVideoShakaControls } from './web-video-shaka-controls';

describe('WebVideoShakaControls', () => {
    const video = {} as HTMLVideoElement;

    function createHarness(playbackStarted?: () => boolean) {
        const environment = createFakeShakaEnvironment({
            onCreate: (player) => {
                player.textTracks = [
                    {
                        id: 3,
                        active: true,
                        language: 'en',
                        label: 'English',
                        kind: 'subtitles',
                    },
                ];
            },
        });
        const state = { showCaptions: false };
        const session = new ShakaVideoSession({
            player: InlinePlaybackPlayer.Html5,
            emitPlaybackIssue: () => undefined,
            showCaptions: () => state.showCaptions,
            loadShaka: environment.loader,
        });
        const controls = new WebVideoShakaControls({
            showCaptions: () => state.showCaptions,
            refresh: () => undefined,
            playbackStarted,
        });
        return { environment, session, controls, state };
    }

    // Vendor-chrome hosts seed the source through ShakaVideoSession.start()
    // and then stop enforcing, mirroring the HLS and native helpers.
    it('stops re-suppressing text once playback started in source-default mode', async () => {
        const settled = { value: false };
        const { environment, session, controls } = createHarness(
            () => settled.value
        );
        controls.bind(session);
        session.start(video, 'http://example.com/subs.mpd');
        await flush();

        const player = environment.instances[0];
        expect(player.textTracks[0].active).toBe(false);

        settled.value = true;
        player.selectTextTrack(player.textTracks[0]);
        controls.refreshInputs();

        expect(player.textTracks[0].active).toBe(true);
    });

    it('still seeds the source before playback started', async () => {
        const { environment, session, controls } = createHarness(() => false);
        controls.bind(session);
        session.start(video, 'http://example.com/subs.mpd');
        await flush();

        const player = environment.instances[0];
        player.selectTextTrack(player.textTracks[0]);
        controls.refreshInputs();

        expect(player.textTracks[0].active).toBe(false);
    });

    it('restores the suppressed caption track when the preference turns on', async () => {
        const { environment, session, controls, state } = createHarness();
        controls.bind(session);
        session.start(video, 'http://example.com/subs.mpd');
        await flush();

        const player = environment.instances[0];
        expect(player.textTracks[0].active).toBe(false);

        state.showCaptions = true;
        controls.refreshInputs();

        expect(player.textTracks[0].active).toBe(true);
    });

    it('keeps an explicit user subtitle-off choice over the preference', async () => {
        const { environment, session, controls, state } = createHarness();
        controls.bind(session);
        session.start(video, 'http://example.com/subs.mpd');
        await flush();

        controls.setSubtitleTrack(-1);
        state.showCaptions = true;
        controls.refreshInputs();

        const player = environment.instances[0];
        expect(player.textTracks[0].active).toBe(false);
    });

    it('lists subtitle tracks with the active flag as selection state', async () => {
        const { environment, session, controls, state } = createHarness();
        state.showCaptions = true;
        controls.bind(session);
        session.start(video, 'http://example.com/subs.mpd');
        await flush();

        expect(controls.getSubtitleTracks()).toEqual([
            { id: 0, label: 'English', selected: true },
        ]);
        expect(environment.instances[0].textTracks[0].active).toBe(true);
    });
});

describe('WebVideoShakaControls quality levels', () => {
    const video = {} as HTMLVideoElement;

    function makeVariant(overrides: {
        id: number;
        height: number;
        bandwidth: number;
        audioId?: number;
        active?: boolean;
        language?: string;
    }) {
        return {
            active: false,
            language: 'en',
            label: null,
            width: Math.round((overrides.height * 16) / 9),
            ...overrides,
        };
    }

    function createHarness() {
        const environment = createFakeShakaEnvironment({
            onCreate: (player) => {
                player.variantTracks = [
                    {
                        id: 1,
                        active: false,
                        language: 'en',
                        label: null,
                        height: 720,
                        width: 1280,
                        bandwidth: 4_000_000,
                    },
                    {
                        id: 2,
                        active: true,
                        language: 'en',
                        label: null,
                        height: 1080,
                        width: 1920,
                        bandwidth: 8_000_000,
                    },
                    {
                        id: 3,
                        active: false,
                        language: 'de',
                        label: null,
                        height: 1080,
                        width: 1920,
                        bandwidth: 8_000_000,
                    },
                ];
            },
        });
        const session = new ShakaVideoSession({
            player: InlinePlaybackPlayer.Html5,
            emitPlaybackIssue: () => undefined,
            showCaptions: () => true,
            loadShaka: environment.loader,
        });
        const controls = new WebVideoShakaControls({
            showCaptions: () => true,
            refresh: () => undefined,
        });
        return { environment, session, controls };
    }

    it('lists active-language variants sorted by resolution, none selected in auto', async () => {
        const { session, controls } = createHarness();
        controls.bind(session);
        session.start(video, 'http://example.com/movie.mpd');
        await flush();

        expect(controls.isAutoQualityEnabled()).toBe(true);
        expect(controls.getQualityLevels()).toEqual([
            { id: 0, label: '1080p', selected: false },
            { id: 1, label: '720p', selected: false },
        ]);
    });

    it('disables ABR before selecting a variant and marks the selection', async () => {
        const { environment, session, controls } = createHarness();
        controls.bind(session);
        session.start(video, 'http://example.com/movie.mpd');
        await flush();

        const player = environment.instances[0];
        const configureCountBefore = player.configureCalls.length;
        controls.setQualityLevel(1);

        expect(player.configureCalls.slice(configureCountBefore)).toEqual([
            { abr: { enabled: false } },
        ]);
        expect(player.selectVariantTrackCalls).toEqual([
            {
                track: expect.objectContaining({ id: 1, language: 'en' }),
                clearBuffer: true,
            },
        ]);
        expect(controls.isAutoQualityEnabled()).toBe(false);
        expect(controls.getQualityLevels()).toEqual([
            { id: 0, label: '1080p', selected: false },
            { id: 1, label: '720p', selected: true },
        ]);
    });

    it('re-enables ABR through the auto sentinel', async () => {
        const { environment, session, controls } = createHarness();
        controls.bind(session);
        session.start(video, 'http://example.com/movie.mpd');
        await flush();

        controls.setQualityLevel(0);
        controls.setQualityLevel(-1);

        const player = environment.instances[0];
        expect(player.configureCalls.at(-1)).toEqual({
            abr: { enabled: true },
        });
        expect(controls.isAutoQualityEnabled()).toBe(true);
        expect(
            controls.getQualityLevels().some((level) => level.selected)
        ).toBe(false);
    });

    it('ignores invalid and out-of-range ids', async () => {
        const { environment, session, controls } = createHarness();
        controls.bind(session);
        session.start(video, 'http://example.com/movie.mpd');
        await flush();

        const player = environment.instances[0];
        const configureCountBefore = player.configureCalls.length;
        controls.setQualityLevel(5);
        controls.setQualityLevel(0.5);
        controls.setQualityLevel(NaN);

        expect(player.configureCalls.length).toBe(configureCountBefore);
        expect(player.selectVariantTrackCalls).toEqual([]);
        expect(controls.isAutoQualityEnabled()).toBe(true);
    });

    it('pins candidates to the active audio id, not just the language', async () => {
        const { environment, session, controls } = createHarness();
        controls.bind(session);
        session.start(video, 'http://example.com/movie.mpd');
        await flush();

        // Same language twice: main (audioId 10, active) vs. commentary
        // (audioId 20). Quality choices must never leak onto the commentary
        // track's variants.
        const player = environment.instances[0];
        player.variantTracks = [
            makeVariant({ id: 1, height: 720, bandwidth: 4e6, audioId: 10 }),
            makeVariant({
                id: 2,
                height: 1080,
                bandwidth: 8e6,
                audioId: 10,
                active: true,
            }),
            makeVariant({ id: 3, height: 720, bandwidth: 4e6, audioId: 20 }),
            makeVariant({ id: 4, height: 1080, bandwidth: 8e6, audioId: 20 }),
        ];

        expect(controls.getQualityLevels()).toEqual([
            { id: 0, label: '1080p', selected: false },
            { id: 1, label: '720p', selected: false },
        ]);

        controls.setQualityLevel(1);
        expect(player.selectVariantTrackCalls).toEqual([
            {
                track: expect.objectContaining({ id: 1, audioId: 10 }),
                clearBuffer: true,
            },
        ]);
    });

    it('forgets a manual selection when the session restarts with a fresh player', async () => {
        const { environment, session, controls } = createHarness();
        controls.bind(session);
        session.start(video, 'http://example.com/movie.mpd');
        await flush();

        controls.setQualityLevel(0);
        expect(controls.isAutoQualityEnabled()).toBe(false);

        session.start(video, 'http://example.com/movie.mpd');
        await flush();

        expect(environment.instances).toHaveLength(2);
        expect(controls.isAutoQualityEnabled()).toBe(true);
        expect(
            controls.getQualityLevels().some((level) => level.selected)
        ).toBe(false);
    });
});
