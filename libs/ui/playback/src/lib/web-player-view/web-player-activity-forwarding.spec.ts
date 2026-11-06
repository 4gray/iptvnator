import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import type { PlaybackActivityEvents } from '@iptvnator/services/activity-events';
import type { WebPlayerViewComponent as WebPlayerViewInstance } from './web-player-view.component';
let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));
beforeAll(async () => {
    ({ WebPlayerViewComponent } = await import('./web-player-view.component'));
});
import { WebPlayerActivity } from './web-player-activity';
import type { PlaybackApplicationOwnership } from './web-player-application-ownership';

function harness(enabled = true) {
    const playback: ResolvedPortalPlayback = {
        streamUrl: 'https://media.example.test/synthetic-episode',
        title: 'Synthetic fixture episode',
        startTime: 60,
        contentInfo: {
            playlistId: 'fixture-source',
            contentType: 'episode',
            contentXtreamId: 2,
            seriesXtreamId: 1,
            activitySessionId: 'fixture-session',
        },
    };
    const events: PlaybackActivityEvents = {
        active: () => enabled,
        begin: async () => undefined,
        checkpoint: jest.fn(async () => undefined),
        register: async () => undefined,
    };
    const activity = new WebPlayerActivity(events);
    activity.begin(playback);
    const emit = jest.fn();
    const view = {
        ownsApplication: () => true,
        activity,
        playback: () => playback,
        recoverySession: { recordTimeUpdate: jest.fn() },
        historyConfirmation: { record: jest.fn() },
        timeUpdate: { emit },
    } as unknown as WebPlayerViewInstance;
    const tick = (currentTime: number) =>
        WebPlayerViewComponent.prototype.handleTimeUpdate.call(
            view,
            { currentTime, duration: 100, playing: false },
            { isLive: false } as PlaybackApplicationOwnership
        );
    return { tick, emit };
}
describe('episode time-update forwarding during resume', () => {
    it('does not forward pre-seek ticks to legacy episode writers and still accepts rewinds', () => {
        const { tick, emit } = harness();
        tick(0);
        expect(emit).not.toHaveBeenCalled();
        tick(60);
        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining({ currentTime: 60 })
        );
        tick(10);
        expect(emit).toHaveBeenLastCalledWith(
            expect.objectContaining({ currentTime: 10 })
        );
    });
    it('preserves local writer events when activity consent is off', () => {
        const { tick, emit } = harness(false);
        tick(0);
        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining({ currentTime: 0 })
        );
    });
});
