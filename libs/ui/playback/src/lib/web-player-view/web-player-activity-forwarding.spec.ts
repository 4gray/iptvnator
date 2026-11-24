import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { InlinePlaybackPlayer } from '@iptvnator/playback/util';
import type { PlaybackActivityEvents } from '@iptvnator/services/activity-events';
import { PlaybackRecoverySession } from './playback-recovery-session';
import { WebPlayerActivity } from './web-player-activity';
import type { PlaybackApplicationOwnership } from './web-player-application-ownership';
import { WebPlayerPlaybackEvents } from './web-player-playback-events';

type PlaybackEventDeps = ConstructorParameters<
    typeof WebPlayerPlaybackEvents
>[0];

function harness(enabled = true, startTime = 60) {
    const playback: ResolvedPortalPlayback = {
        streamUrl: 'https://media.example.test/synthetic-episode',
        title: 'Synthetic fixture episode',
        startTime,
        contentInfo: {
            playlistId: 'fixture-source',
            contentType: 'episode',
            contentXtreamId: 2,
            seriesXtreamId: 1,
            activitySessionId: 'fixture-session',
        },
    };
    const checkpoint = jest.fn(async () => undefined);
    const events: PlaybackActivityEvents = {
        active: () => enabled,
        begin: async () => undefined,
        checkpoint,
        register: async () => undefined,
    };
    const activity = new WebPlayerActivity(events);
    activity.begin(playback);
    const emit = jest.fn();
    const recordHistory = jest.fn();
    const recoverySession = new PlaybackRecoverySession();
    const token = Symbol();
    const playbackEvents = new WebPlayerPlaybackEvents({
        owns: () => true,
        activity,
        playback: () => playback,
        resolvedPlayback: () => playback,
        isLive: () => false,
        startTime: () => startTime,
        token: () => token,
        recovery: {
            recordTimeUpdate: () => false,
        } as unknown as PlaybackEventDeps['recovery'],
        recoverySession,
        history: {
            record: recordHistory,
        } as unknown as PlaybackEventDeps['history'],
        timeUpdate: { emit } as unknown as PlaybackEventDeps['timeUpdate'],
        started: { emit: jest.fn() } as unknown as PlaybackEventDeps['started'],
        ended: { emit: jest.fn() } as unknown as PlaybackEventDeps['ended'],
    });
    const ownership: PlaybackApplicationOwnership = {
        binding: null,
        embeddedMpv: false,
        isLive: false,
        sourceRevision: Symbol(),
        token,
    };
    const tick = (currentTime: number, playing = false) =>
        playbackEvents.webPosition(
            { currentTime, duration: 100, playing },
            ownership
        );
    return {
        tick,
        emit,
        checkpoint,
        recordHistory,
        returnFromMedia3: (currentTime: number) => {
            const update = {
                currentTime,
                duration: 100,
                playing: false,
                checkpoint: true as const,
            };
            activity.record(playback, update);
            recoverySession.recordTimeUpdate(update, false);
            recoverySession.beginPlayback(InlinePlaybackPlayer.Html5);
            checkpoint.mockClear();
        },
        handoffOffset: () =>
            recoverySession.resumeStartTime(playback.startTime!, false),
    };
}
describe('episode time-update forwarding during resume', () => {
    it('forwards genuine playback to history while preserving the pending resume point', () => {
        const { tick, emit, recordHistory } = harness(false);
        tick(3, true);
        expect(recordHistory).toHaveBeenCalledWith(3, true);
        expect(emit).not.toHaveBeenCalled();
    });
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
    it.each([true, false])(
        'keeps the Media3 position until the web seek settles (Activity Sync: %s)',
        (enabled) => {
            const { tick, emit, checkpoint, handoffOffset, returnFromMedia3 } =
                harness(enabled, 0);
            returnFromMedia3(60);

            tick(0);
            expect(handoffOffset()).toBe(60);
            expect(emit).not.toHaveBeenCalled();
            expect(checkpoint).not.toHaveBeenCalled();

            tick(60);
            tick(10);
            expect(handoffOffset()).toBe(10);
            expect(emit).toHaveBeenLastCalledWith(
                expect.objectContaining({ currentTime: 10 })
            );
            if (enabled)
                expect(checkpoint).toHaveBeenLastCalledWith(
                    expect.objectContaining({ positionSeconds: 10 })
                );
        }
    );
});
