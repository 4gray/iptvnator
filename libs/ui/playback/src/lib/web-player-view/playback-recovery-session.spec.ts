import {
    InlinePlaybackPlayer,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import { PlaybackRecoverySession } from './playback-recovery-session';

describe('PlaybackRecoverySession', () => {
    it('tracks failure, switch resume, and a reset across sessions', () => {
        const session = new PlaybackRecoverySession();

        expect(session.syncSession('movie-a')).toBe(true);
        const firstBinding = session.beginPlayback(
            InlinePlaybackPlayer.VideoJs
        );
        expect(session.recordFailure(firstBinding)).toBe(true);
        expect([...session.attemptedTargets()]).toEqual([
            InlinePlaybackPlayer.VideoJs,
        ]);

        session.recordTimeUpdate({ currentTime: 42, duration: 120 }, false);
        expect(
            session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false)
        ).toBe(true);
        const replacementBinding = session.beginPlayback(
            InlinePlaybackPlayer.Html5
        );
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.Html5
        );
        expect(session.resumeStartTime(0, false)).toBe(42);

        const previousAttempts = session.attemptedTargets();
        expect(session.syncSession('movie-b')).toBe(true);
        expect(session.attemptedTargets()).not.toBe(previousAttempts);
        expect(session.attemptedTargets()).toEqual(new Set());
        expect(session.temporaryPlayerOverride()).toBeNull();
        expect(session.switchPending()).toBe(false);
        expect(session.activeBinding()).toBeNull();
        expect(session.recordFailure(firstBinding)).toBe(false);
        expect(session.resumeStartTime(0, false)).toBe(0);
        const newBinding = session.beginPlayback(
            InlinePlaybackPlayer.ArtPlayer
        );
        expect(newBinding.generation).toBe(replacementBinding.generation + 2);
    });

    it('treats the same exact session key as a no-op', () => {
        const session = new PlaybackRecoverySession();
        session.syncSession('movie-a');
        const binding = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        session.recordInlineAttempt(InlinePlaybackPlayer.ArtPlayer);
        session.recordTimeUpdate({ currentTime: 24, duration: 100 }, false);
        const attempts = session.attemptedTargets();

        expect(session.syncSession('movie-a')).toBe(false);
        expect(session.attemptedTargets()).toBe(attempts);
        expect(session.activeBinding()).toBe(binding);
        expect(session.accepts(binding)).toBe(true);

        session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false);
        const switchAttempts = session.attemptedTargets();
        expect(session.syncSession('movie-a')).toBe(false);
        expect(session.attemptedTargets()).toBe(switchAttempts);
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.Html5
        );
        expect(session.switchPending()).toBe(true);
        expect(session.resumeStartTime(5, false)).toBe(24);
        expect(session.activeBinding()).toBeNull();
        expect(session.accepts(binding)).toBe(false);
    });

    it('accepts an empty session key and compares keys exactly', () => {
        const session = new PlaybackRecoverySession();

        expect(session.syncSession('')).toBe(true);
        expect(session.syncSession('')).toBe(false);
        expect(session.syncSession(' ')).toBe(true);
    });

    it('advances the generation whenever playback begins', () => {
        const session = new PlaybackRecoverySession();
        session.syncSession('movie-a');
        session.recordInlineAttempt(InlinePlaybackPlayer.ArtPlayer);

        const first = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        const second = session.beginPlayback(InlinePlaybackPlayer.VideoJs);

        expect(second.generation).toBe(first.generation + 1);
        expect(session.accepts(first)).toBe(false);
        expect(session.accepts(second)).toBe(true);
        expect(session.attemptedTargets()).toEqual(
            new Set([InlinePlaybackPlayer.ArtPlayer])
        );
    });

    it('preserves session attempts across an alternative source binding', () => {
        const session = new PlaybackRecoverySession();
        session.syncSession('movie-a');
        const first = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        session.recordFailure(first);
        session.beginRetry();

        const alternative = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        session.settle(first);

        expect(session.accepts(first)).toBe(false);
        expect(session.accepts(alternative)).toBe(true);
        expect(session.switchPending()).toBe(true);
        expect(session.attemptedTargets()).toEqual(
            new Set([InlinePlaybackPlayer.VideoJs])
        );
        session.settle(alternative);
        expect(session.switchPending()).toBe(false);
    });

    it('clears playback binding and prevents retry without resetting session data', () => {
        const session = new PlaybackRecoverySession();
        session.syncSession('movie-a');
        session.recordTimeUpdate({ currentTime: 17, duration: 80 }, false);
        session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false);
        const binding = session.beginPlayback(InlinePlaybackPlayer.Html5);
        session.settle(binding);
        session.recordInlineAttempt(InlinePlaybackPlayer.ArtPlayer);

        session.clearPlaybackBinding();

        expect(session.activeBinding()).toBeNull();
        expect(session.accepts(binding)).toBe(false);
        expect(session.beginRetry()).toBe(false);
        expect(session.attemptedTargets()).toEqual(
            new Set([
                InlinePlaybackPlayer.Html5,
                InlinePlaybackPlayer.ArtPlayer,
            ])
        );
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.Html5
        );
        expect(session.resumeStartTime(0, false)).toBe(17);
        const nextBinding = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        expect(nextBinding.generation).toBe(binding.generation + 2);
    });

    it('accepts only a matching active generation and target', () => {
        const session = new PlaybackRecoverySession();
        expect(
            session.accepts({
                generation: 0,
                target: InlinePlaybackPlayer.VideoJs,
            })
        ).toBe(false);

        const binding = session.beginPlayback(InlinePlaybackPlayer.VideoJs);

        expect(session.accepts({ ...binding })).toBe(true);
        expect(
            session.accepts({
                generation: binding.generation,
                target: InlinePlaybackPlayer.Html5,
            })
        ).toBe(false);
    });

    it('exposes an immutable active binding snapshot', () => {
        const session = new PlaybackRecoverySession();
        const binding = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        const activeBinding = session.activeBinding();

        expect(Object.isFrozen(binding)).toBe(true);
        expect(activeBinding).toBe(binding);
        expect(activeBinding).toEqual({
            generation: 1,
            target: InlinePlaybackPlayer.VideoJs,
        });
        expect(Object.keys(activeBinding ?? {})).toEqual([
            'generation',
            'target',
        ]);
        expect(Object.isFrozen(activeBinding)).toBe(true);
        expect('set' in session.attemptedTargets).toBe(false);
        expect('set' in session.temporaryPlayerOverride).toBe(false);
        expect('set' in session.switchPending).toBe(false);
        expect('set' in session.activeBinding).toBe(false);
        expect(
            Reflect.set(
                binding as unknown as Record<string, unknown>,
                'target',
                InlinePlaybackPlayer.Html5
            )
        ).toBe(false);
        expect(session.activeBinding()?.target).toBe(
            InlinePlaybackPlayer.VideoJs
        );
        expect(
            session.accepts({
                generation: binding.generation,
                target: InlinePlaybackPlayer.Html5,
            })
        ).toBe(false);
    });

    it('copies attempted targets for every inline and external attempt', () => {
        const session = new PlaybackRecoverySession();
        const initial = session.attemptedTargets();

        session.recordInlineAttempt(InlinePlaybackPlayer.VideoJs);
        const inline = session.attemptedTargets();
        session.recordInlineAttempt(InlinePlaybackPlayer.VideoJs);
        const duplicate = session.attemptedTargets();
        session.recordExternalAttempt('mpv');
        const external = session.attemptedTargets();

        expect(initial).toEqual(new Set());
        expect(inline).toEqual(new Set([InlinePlaybackPlayer.VideoJs]));
        expect(duplicate).toEqual(new Set([InlinePlaybackPlayer.VideoJs]));
        expect(external).toEqual(
            new Set<PlaybackRecommendationTarget>([
                InlinePlaybackPlayer.VideoJs,
                'mpv',
            ])
        );
        expect(inline).not.toBe(initial);
        expect(duplicate).not.toBe(inline);
        expect(external).not.toBe(duplicate);
    });

    it('copies attempts and clears pending for an accepted failure', () => {
        const session = new PlaybackRecoverySession();
        session.beginPlayback(InlinePlaybackPlayer.Html5);
        session.beginRetry();
        const binding = session.beginPlayback(InlinePlaybackPlayer.Html5);
        const attempts = session.attemptedTargets();

        expect(session.recordFailure(binding)).toBe(true);
        expect(session.attemptedTargets()).not.toBe(attempts);
        expect(session.attemptedTargets()).toEqual(
            new Set([InlinePlaybackPlayer.Html5])
        );
        expect(session.switchPending()).toBe(false);
    });

    it('rejects the old binding throughout the switch pre-effect interval', () => {
        const session = new PlaybackRecoverySession();
        const oldBinding = session.beginPlayback(InlinePlaybackPlayer.VideoJs);

        expect(
            session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false)
        ).toBe(true);
        const attempts = session.attemptedTargets();
        expect(session.activeBinding()).toBeNull();
        expect(session.recordFailure(oldBinding)).toBe(false);
        expect(session.attemptedTargets()).toBe(attempts);
        session.settle(oldBinding);
        expect(session.switchPending()).toBe(true);
        expect(session.attemptedTargets()).toBe(attempts);
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.Html5
        );

        const replacement = session.beginPlayback(InlinePlaybackPlayer.Html5);
        session.settle(replacement);
        expect(session.switchPending()).toBe(false);
    });

    it('rejects the old binding throughout the retry pre-effect interval', () => {
        const session = new PlaybackRecoverySession();
        session.recordInlineAttempt(InlinePlaybackPlayer.ArtPlayer);
        const oldBinding = session.beginPlayback(InlinePlaybackPlayer.VideoJs);

        expect(session.beginRetry()).toBe(true);
        const attempts = session.attemptedTargets();
        expect(session.activeBinding()).toBeNull();
        expect(session.recordFailure(oldBinding)).toBe(false);
        expect(session.attemptedTargets()).toBe(attempts);
        session.settle(oldBinding);
        expect(session.switchPending()).toBe(true);
        expect(session.attemptedTargets()).toBe(attempts);
        expect(session.temporaryPlayerOverride()).toBeNull();

        const replacement = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        expect(session.recordFailure(replacement)).toBe(true);
        expect(session.switchPending()).toBe(false);
        expect(session.attemptedTargets()).not.toBe(attempts);
        expect(session.attemptedTargets()).toEqual(
            new Set([
                InlinePlaybackPlayer.ArtPlayer,
                InlinePlaybackPlayer.VideoJs,
            ])
        );
    });

    it('leaves all state unchanged for a stale failure', () => {
        const session = new PlaybackRecoverySession();
        const stale = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false);
        const current = session.beginPlayback(InlinePlaybackPlayer.Html5);
        const attempts = session.attemptedTargets();

        expect(session.recordFailure(stale)).toBe(false);
        expect(session.attemptedTargets()).toBe(attempts);
        expect(session.switchPending()).toBe(true);
        expect(session.activeBinding()).toBe(current);
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.Html5
        );
    });

    it('settles only the matching binding without recording an attempt', () => {
        const session = new PlaybackRecoverySession();
        const stale = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false);
        const current = session.beginPlayback(InlinePlaybackPlayer.Html5);
        const attempts = session.attemptedTargets();

        session.settle(stale);
        expect(session.switchPending()).toBe(true);
        expect(session.attemptedTargets()).toBe(attempts);

        session.settle(current);
        expect(session.switchPending()).toBe(false);
        expect(session.attemptedTargets()).toBe(attempts);
    });

    it('records a switch immediately and clears resume only for live playback', () => {
        const session = new PlaybackRecoverySession();
        session.recordTimeUpdate({ currentTime: 31, duration: 90 }, false);
        const attempts = session.attemptedTargets();

        expect(
            session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, true)
        ).toBe(true);

        expect(session.attemptedTargets()).not.toBe(attempts);
        expect(session.attemptedTargets()).toEqual(
            new Set([InlinePlaybackPlayer.Html5])
        );
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.Html5
        );
        expect(session.switchPending()).toBe(true);
        expect(session.resumeStartTime(7, false)).toBe(7);
    });

    it('allows only the switch when a switch races a retry', () => {
        const session = new PlaybackRecoverySession();
        session.beginPlayback(InlinePlaybackPlayer.VideoJs);

        expect(
            session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false)
        ).toBe(true);
        const replacement = session.beginPlayback(InlinePlaybackPlayer.Html5);
        const attempts = session.attemptedTargets();
        expect(session.beginRetry()).toBe(false);

        expect(session.attemptedTargets()).toBe(attempts);
        expect(session.activeBinding()).toBe(replacement);
        expect(session.accepts(replacement)).toBe(true);
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.Html5
        );
        expect(session.switchPending()).toBe(true);
        session.settle(replacement);
        const bindingAfterRejectedRetry = session.beginPlayback(
            InlinePlaybackPlayer.Html5
        );
        expect(bindingAfterRejectedRetry.generation).toBe(
            replacement.generation + 1
        );
    });

    it('allows only the retry when a retry races a switch', () => {
        const session = new PlaybackRecoverySession();
        session.recordInlineAttempt(InlinePlaybackPlayer.ArtPlayer);
        session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        session.beginPlayerSwitch(InlinePlaybackPlayer.ArtPlayer, false);
        const switched = session.beginPlayback(InlinePlaybackPlayer.ArtPlayer);
        session.settle(switched);

        expect(session.beginRetry()).toBe(true);
        const replacement = session.beginPlayback(
            InlinePlaybackPlayer.ArtPlayer
        );
        const attempts = session.attemptedTargets();
        expect(
            session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false)
        ).toBe(false);

        expect(session.attemptedTargets()).toBe(attempts);
        expect(session.activeBinding()).toBe(replacement);
        expect(session.accepts(replacement)).toBe(true);
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.ArtPlayer
        );
        expect(session.switchPending()).toBe(true);
        session.settle(replacement);
        const bindingAfterRejectedSwitch = session.beginPlayback(
            InlinePlaybackPlayer.ArtPlayer
        );
        expect(bindingAfterRejectedSwitch.generation).toBe(
            replacement.generation + 1
        );
    });

    it('begins retry only with an active binding and preserves state', () => {
        const session = new PlaybackRecoverySession();
        session.recordInlineAttempt(InlinePlaybackPlayer.ArtPlayer);
        expect(session.beginRetry()).toBe(false);

        const initial = session.beginPlayback(InlinePlaybackPlayer.VideoJs);
        expect(initial.generation).toBe(1);
        session.beginPlayerSwitch(InlinePlaybackPlayer.Html5, false);
        const switched = session.beginPlayback(InlinePlaybackPlayer.Html5);
        session.settle(switched);
        const attempts = session.attemptedTargets();

        expect(session.beginRetry()).toBe(true);
        expect(session.attemptedTargets()).toBe(attempts);
        expect(session.activeBinding()).toBeNull();
        expect(session.temporaryPlayerOverride()).toBe(
            InlinePlaybackPlayer.Html5
        );
        expect(session.beginRetry()).toBe(false);
    });

    it.each([
        [{ currentTime: 9, duration: 20 }, true],
        [{ currentTime: Number.NaN, duration: 20 }, false],
        [{ currentTime: Number.POSITIVE_INFINITY, duration: 20 }, false],
        [{ currentTime: Number.NEGATIVE_INFINITY, duration: 20 }, false],
        [{ currentTime: -1, duration: 20 }, false],
    ])('ignores invalid or live time update %#', (event, isLive) => {
        const session = new PlaybackRecoverySession();
        session.recordTimeUpdate({ currentTime: 13, duration: 40 }, false);

        session.recordTimeUpdate(event, isLive);

        expect(session.resumeStartTime(3, false)).toBe(13);
    });

    it('stores any finite non-negative VOD time without interpreting duration', () => {
        const session = new PlaybackRecoverySession();

        session.recordTimeUpdate(
            { currentTime: 0, duration: Number.NaN },
            false
        );
        expect(session.resumeStartTime(8, false)).toBe(0);
        session.recordTimeUpdate({ currentTime: 75, duration: 10 }, false);
        expect(session.resumeStartTime(8, false)).toBe(75);
    });

    it('always returns zero for live and otherwise preserves the host start time', () => {
        const session = new PlaybackRecoverySession();

        expect(session.resumeStartTime(19, false)).toBe(19);
        expect(session.resumeStartTime(19, true)).toBe(0);

        session.recordTimeUpdate({ currentTime: 44, duration: 100 }, false);
        expect(session.resumeStartTime(19, true)).toBe(0);
        expect(session.resumeStartTime(19, false)).toBe(44);
    });

    it('does not let stale callbacks clear pending for a new session', () => {
        const stale = new PlaybackRecoverySession();
        stale.syncSession('movie-a');
        const oldBinding = stale.beginPlayback(InlinePlaybackPlayer.VideoJs);
        stale.syncSession('movie-b');
        stale.beginPlayback(InlinePlaybackPlayer.VideoJs);
        stale.beginRetry();

        stale.settle(oldBinding);
        expect(stale.switchPending()).toBe(true);
        expect(stale.recordFailure(oldBinding)).toBe(false);
        expect(stale.switchPending()).toBe(true);
    });
});
