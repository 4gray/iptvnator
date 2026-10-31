import { WebPlayerActivity } from './web-player-activity';
import type { PlaybackActivityEvents } from '@iptvnator/services/activity-events';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

const playback = (session: string): ResolvedPortalPlayback => ({
    streamUrl: 'https://media.test/movie',
    title: 'Movie',
    contentInfo: {
        playlistId: 'source',
        contentType: 'vod',
        contentXtreamId: 1,
        activitySessionId: session,
    },
});
function harness(enabled = true) {
    const events: PlaybackActivityEvents = {
        active: () => enabled,
        begin: jest.fn(async () => undefined),
        checkpoint: jest.fn(async () => undefined),
        register: jest.fn(async () => undefined),
    };
    return { events, activity: new WebPlayerActivity(events) };
}
describe('owned web-player activity', () => {
    afterEach(() => jest.restoreAllMocks());
    it('flushes the last short-video position even between periodic checkpoints', () => {
        jest.spyOn(Date, 'now').mockReturnValue(10000);
        const { events, activity } = harness();
        const media = playback('a');
        activity.begin(media);
        activity.record(media, { currentTime: 2, duration: 6, playing: true });
        activity.record(media, {
            currentTime: 5.8,
            duration: 6,
            playing: true,
        });
        expect(events.checkpoint).toHaveBeenCalledTimes(1);
        activity.flush();
        expect(events.checkpoint).toHaveBeenLastCalledWith(
            expect.objectContaining({
                activitySessionId: 'a',
                positionSeconds: 5.8,
                durationSeconds: 6,
            })
        );
        activity.flush();
        expect(events.checkpoint).toHaveBeenCalledTimes(2);
    });
    it('keeps an old pending snapshot attached to its original session when switching content', () => {
        jest.spyOn(Date, 'now').mockReturnValue(10000);
        const { events, activity } = harness();
        const first = playback('a');
        const next = playback('b');
        activity.begin(first);
        activity.record(first, { currentTime: 10, duration: 100 });
        activity.record(first, { currentTime: 12, duration: 100 });
        activity.begin(next);
        expect(events.checkpoint).toHaveBeenLastCalledWith(
            expect.objectContaining({
                activitySessionId: 'a',
                positionSeconds: 12,
            })
        );
        activity.record(next, {
            currentTime: 1,
            duration: 100,
            playing: false,
        });
        expect(events.checkpoint).toHaveBeenLastCalledWith(
            expect.objectContaining({
                activitySessionId: 'b',
                positionSeconds: 1,
            })
        );
    });
    it('does not persist playback through activity when consent is disabled', () => {
        const { events, activity } = harness(false);
        activity.record(playback('old-local-session'), {
            currentTime: 99,
            duration: 100,
            playing: false,
        });
        activity.flush();
        expect(events.checkpoint).not.toHaveBeenCalled();
    });
    it('records actual completion even when the final fractional tick was already flushed', () => {
        const { events, activity } = harness();
        const media = playback('short');
        activity.begin(media);
        activity.record(media, {
            currentTime: 5.98,
            duration: 6,
            playing: false,
        });
        activity.finish();
        expect(events.checkpoint).toHaveBeenLastCalledWith(
            expect.objectContaining({
                activitySessionId: 'short',
                positionSeconds: 6,
                durationSeconds: 6,
            })
        );
    });
    it('does not complete the old movie when the same view switches to a live stream', () => {
        const { events, activity } = harness();
        const media = playback('movie');
        activity.begin(media);
        activity.record(media, {
            currentTime: 35,
            duration: 100,
            playing: true,
        });
        activity.begin({
            streamUrl: 'https://live.test/stream',
            title: 'Live',
            isLive: true,
        });
        const calls = (events.checkpoint as jest.Mock).mock.calls.length;
        activity.finish();
        expect(events.checkpoint).toHaveBeenCalledTimes(calls);
    });
});
