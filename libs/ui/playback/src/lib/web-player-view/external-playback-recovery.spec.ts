import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import {
    EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS,
    ExternalPlaybackRecovery,
} from './external-playback-recovery';

function session(
    overrides: Partial<ExternalPlayerSession> = {}
): ExternalPlayerSession {
    return {
        id: 'session-1',
        player: 'mpv',
        status: 'opened',
        title: 'Example',
        streamUrl: 'https://user:secret@example.com/stream.mkv?token=private',
        startedAt: '2026-08-08T10:00:00.000Z',
        updatedAt: '2026-08-08T10:00:01.000Z',
        canClose: true,
        ...overrides,
    };
}

describe('ExternalPlaybackRecovery', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('starts one external launch intent and rejects a competing target', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');

        const intent = recovery.begin('mpv');

        expect(intent).not.toBeNull();
        expect(recovery.pending()).toBe(true);
        expect(recovery.target('mpv')).toEqual({
            attempts: 1,
            sessionId: null,
            status: 'launching',
        });
        expect(recovery.begin('vlc')).toBeNull();
        recovery.destroy();
    });

    it('requires the exact owned launch result before accepting session updates', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const intent = requireIntent(recovery.begin('mpv'));

        expect(
            recovery.observe(session({ id: 'old-session', status: 'playing' }))
        ).toBe(false);
        expect(
            recovery.observe(
                session({ id: 'vlc-session', player: 'vlc', status: 'opened' })
            )
        ).toBe(false);
        expect(
            recovery.observe(
                session({ id: 'mpv-session', player: 'mpv', status: 'opened' })
            )
        ).toBe(false);
        expect(
            recovery.confirm(
                intent,
                session({ id: 'mpv-session', player: 'mpv', status: 'opened' })
            )
        ).toBe(true);
        expect(recovery.target('mpv')).toEqual({
            attempts: 1,
            sessionId: 'mpv-session',
            status: 'started',
        });
        expect(recovery.pending()).toBe(false);

        expect(
            recovery.observe(
                session({ id: 'other-mpv', player: 'mpv', status: 'error' })
            )
        ).toBe(false);
        expect(recovery.target('mpv').status).toBe('started');
        recovery.destroy();
    });

    it.each([
        ['playing', 'playing'],
        ['error', 'error'],
    ] as const)('maps exact session %s to %s', (sessionStatus, stateStatus) => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const intent = requireIntent(recovery.begin('mpv'));
        recovery.confirm(
            intent,
            session({ id: 'mpv-session', status: 'opened' })
        );

        expect(
            recovery.observe(
                session({ id: 'mpv-session', status: sessionStatus })
            )
        ).toBe(true);
        expect(recovery.target('mpv').status).toBe(stateStatus);
        recovery.destroy();
    });

    it('returns a closed exact session to idle while retaining attempt history', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const intent = requireIntent(recovery.begin('mpv'));
        recovery.confirm(
            intent,
            session({ id: 'mpv-session', status: 'opened' })
        );

        expect(
            recovery.observe(
                session({
                    id: 'mpv-session',
                    status: 'closed',
                    canClose: false,
                })
            )
        ).toBe(true);
        expect(recovery.target('mpv')).toEqual({
            attempts: 1,
            sessionId: null,
            status: 'idle',
        });
        recovery.destroy();
    });

    it('times out a missing launch handoff without accepting its later session', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        recovery.begin('mpv');

        jest.advanceTimersByTime(EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS);

        expect(recovery.pending()).toBe(false);
        expect(recovery.target('mpv').status).toBe('error');
        expect(
            recovery.observe(session({ id: 'late-session', status: 'opened' }))
        ).toBe(false);
        recovery.destroy();
    });

    it('keeps an exact launching session correlated after the local timeout', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const intent = requireIntent(recovery.begin('mpv'));
        recovery.confirm(
            intent,
            session({ id: 'slow-mpv', player: 'mpv', status: 'launching' })
        );

        jest.advanceTimersByTime(EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS);

        expect(recovery.target('mpv')).toEqual({
            attempts: 1,
            sessionId: 'slow-mpv',
            status: 'error',
        });
        expect(
            recovery.observe(
                session({ id: 'slow-mpv', player: 'mpv', status: 'playing' })
            )
        ).toBe(true);
        expect(recovery.target('mpv').status).toBe('playing');
        recovery.destroy();
    });

    it('invalidates an old intent and timer when the content session changes', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const intent = recovery.begin('mpv');
        expect(intent).not.toBeNull();

        recovery.syncSession('content-b');
        jest.advanceTimersByTime(EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS);

        expect(recovery.owns(requireIntent(intent))).toBe(false);
        expect(recovery.pending()).toBe(false);
        expect(recovery.target('mpv')).toEqual({
            attempts: 0,
            sessionId: null,
            status: 'idle',
        });
        expect(
            recovery.observe(session({ id: 'stale-session', status: 'error' }))
        ).toBe(false);
        recovery.destroy();
    });

    it('clears the launch timer and ownership when destroyed', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        recovery.begin('mpv');

        recovery.destroy();
        jest.advanceTimersByTime(EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS);

        expect(jest.getTimerCount()).toBe(0);
        expect(recovery.pending()).toBe(false);
        expect(recovery.target('mpv').status).toBe('launching');
    });

    it('fails only the current intent and counts a later retry', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const first = requireIntent(recovery.begin('mpv'));

        expect(recovery.fail(first)).toBe(true);
        expect(recovery.fail(first)).toBe(false);
        const second = requireIntent(recovery.begin('mpv'));

        expect(recovery.target('mpv')).toEqual({
            attempts: 2,
            sessionId: null,
            status: 'launching',
        });
        expect(recovery.owns(second)).toBe(true);
        recovery.destroy();
    });

    it('rejects a late result from a timed-out attempt while accepting the retry result', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const first = requireIntent(recovery.begin('mpv'));
        jest.advanceTimersByTime(EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS);
        const retry = requireIntent(recovery.begin('mpv'));

        expect(
            recovery.confirm(
                first,
                session({ id: 'late-first', status: 'opened' })
            )
        ).toBe(false);
        expect(
            recovery.observe(session({ id: 'late-first', status: 'playing' }))
        ).toBe(false);
        expect(
            recovery.confirm(
                retry,
                session({ id: 'exact-retry', status: 'opened' })
            )
        ).toBe(true);
        expect(recovery.target('mpv')).toEqual({
            attempts: 2,
            sessionId: 'exact-retry',
            status: 'started',
        });
        recovery.destroy();
    });

    it('cancels an unlaunched current intent without reporting an error', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const intent = requireIntent(recovery.begin('vlc'));

        expect(recovery.cancel(intent)).toBe(true);
        expect(recovery.pending()).toBe(false);
        expect(recovery.target('vlc')).toEqual({
            attempts: 1,
            sessionId: null,
            status: 'idle',
        });
        recovery.destroy();
    });

    it('updates the previous exact session without cancelling a different target intent', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const mpvIntent = requireIntent(recovery.begin('mpv'));
        recovery.confirm(
            mpvIntent,
            session({ id: 'mpv-session', status: 'opened' })
        );
        const vlcIntent = requireIntent(recovery.begin('vlc'));

        expect(
            recovery.observe(
                session({
                    id: 'mpv-session',
                    status: 'closed',
                    canClose: false,
                })
            )
        ).toBe(true);
        expect(recovery.target('mpv').status).toBe('idle');
        expect(recovery.owns(vlcIntent)).toBe(true);
        expect(recovery.pending()).toBe(true);
        recovery.destroy();
    });

    it('applies a confirmed exact close even when a reactive observer coalesces it', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const mpvIntent = requireIntent(recovery.begin('mpv'));
        recovery.confirm(
            mpvIntent,
            session({ id: 'mpv-session', status: 'opened' })
        );

        expect(recovery.close('mpv', 'mpv-session')).toBe(true);
        expect(recovery.target('mpv')).toEqual({
            attempts: 1,
            sessionId: null,
            status: 'idle',
        });
        expect(recovery.close('mpv', 'other-session')).toBe(false);
        recovery.destroy();
    });

    it('stores no stream URL, headers, credentials, title, or error text', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const intent = requireIntent(recovery.begin('mpv'));
        recovery.confirm(
            intent,
            session({
                error: 'token=private at /Users/example/player',
                headers: undefined,
                id: 'safe-id',
                status: 'error',
            } as Partial<ExternalPlayerSession>)
        );

        const serialized = JSON.stringify(recovery.states());
        expect(serialized).toContain('safe-id');
        expect(serialized).not.toContain('example.com');
        expect(serialized).not.toContain('private');
        expect(serialized).not.toContain('/Users/example');
        expect(serialized).not.toContain('Example');
        recovery.destroy();
    });
});

function requireIntent<T>(intent: T | null): T {
    if (intent === null) {
        throw new Error('Expected an external recovery intent');
    }
    return intent;
}
