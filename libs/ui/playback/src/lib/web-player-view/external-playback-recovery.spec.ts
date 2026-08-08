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

        const intent = recovery.begin('mpv', 'old-session');

        expect(intent).not.toBeNull();
        expect(recovery.pending()).toBe(true);
        expect(recovery.target('mpv')).toEqual({
            attempts: 1,
            sessionId: null,
            status: 'launching',
        });
        expect(recovery.begin('vlc', 'old-session')).toBeNull();
        recovery.destroy();
    });

    it('correlates only the next matching target and then requires its exact id', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        recovery.begin('mpv', 'old-session');

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
        recovery.begin('mpv', null);
        recovery.observe(session({ id: 'mpv-session', status: 'opened' }));

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
        recovery.begin('mpv', null);
        recovery.observe(session({ id: 'mpv-session', status: 'opened' }));

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
        recovery.begin('mpv', null);

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
        recovery.begin('mpv', null);
        recovery.observe(
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
        const intent = recovery.begin('mpv', null);
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
        recovery.begin('mpv', null);

        recovery.destroy();
        jest.advanceTimersByTime(EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS);

        expect(jest.getTimerCount()).toBe(0);
        expect(recovery.pending()).toBe(false);
        expect(recovery.target('mpv').status).toBe('launching');
    });

    it('fails only the current intent and counts a later retry', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        const first = requireIntent(recovery.begin('mpv', null));

        expect(recovery.fail(first)).toBe(true);
        expect(recovery.fail(first)).toBe(false);
        const second = requireIntent(recovery.begin('mpv', null));

        expect(recovery.target('mpv')).toEqual({
            attempts: 2,
            sessionId: null,
            status: 'launching',
        });
        expect(recovery.owns(second)).toBe(true);
        recovery.destroy();
    });

    it('updates the previous exact session without cancelling a different target intent', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        recovery.begin('mpv', null);
        recovery.observe(session({ id: 'mpv-session', status: 'opened' }));
        const vlcIntent = requireIntent(recovery.begin('vlc', 'mpv-session'));

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

    it('stores no stream URL, headers, credentials, title, or error text', () => {
        const recovery = new ExternalPlaybackRecovery();
        recovery.syncSession('content-a');
        recovery.begin('mpv', null);
        recovery.observe(
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
