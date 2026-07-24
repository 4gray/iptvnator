import { InlinePlaybackPlayer } from '../playback-diagnostics/playback-diagnostics.model';
import {
    createFakeShakaEnvironment,
    flushShakaMicrotasks as flush,
} from '../shaka-engine/shaka-player-test-double';
import { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import { WebVideoShakaControls } from './web-video-shaka-controls';

describe('WebVideoShakaControls', () => {
    const video = {} as HTMLVideoElement;

    function createHarness() {
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
        });
        return { environment, session, controls, state };
    }

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
