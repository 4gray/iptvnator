import { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { ExternalPlayerSessionRegistry } from './external-player-session-registry';

describe('ExternalPlayerSessionRegistry', () => {
    let updates: ExternalPlayerSession[];
    let registry: ExternalPlayerSessionRegistry;

    beforeEach(() => {
        updates = [];
        registry = new ExternalPlayerSessionRegistry((session) => {
            updates.push(session);
        });
    });

    it('creates launching sessions and marks them opened', () => {
        const session = registry.beginSession({
            player: 'mpv',
            title: 'Example',
            streamUrl: 'https://example.com/video.m3u8',
        });

        expect(session.status).toBe('launching');
        expect(registry.getActiveSessionId()).toBe(session.id);

        const opened = registry.markOpened(session.id);
        expect(opened?.status).toBe('opened');
        expect(updates.at(-1)?.status).toBe('opened');
    });

    it('keeps close capability and closes the session explicitly', async () => {
        const close = jest.fn();
        const session = registry.beginSession({
            player: 'vlc',
            title: 'Example',
            streamUrl: 'https://example.com/video.m3u8',
        });

        registry.attachCloser(session.id, close);

        expect(registry.getSession(session.id)?.canClose).toBe(true);

        const closed = await registry.closeSession(session.id);

        expect(close).toHaveBeenCalled();
        expect(closed?.status).toBe('closed');
        expect(closed?.canClose).toBe(false);
        expect(registry.getActiveSessionId()).toBeNull();
    });

    it('does not invoke a stale closer for an already closed session', async () => {
        const close = jest.fn();
        const session = registry.beginSession({
            player: 'mpv',
            title: 'Closed',
            streamUrl: 'https://example.com/closed.m3u8',
        });
        registry.attachCloser(session.id, close);
        registry.markClosed(session.id);

        const closed = await registry.closeSession(session.id);

        expect(close).not.toHaveBeenCalled();
        expect(closed).toMatchObject({
            id: session.id,
            status: 'closed',
            canClose: false,
        });
    });

    it('keeps the session live when runtime close cannot be confirmed', async () => {
        const close = jest.fn().mockRejectedValue(new Error('close failed'));
        const session = registry.beginSession({
            player: 'vlc',
            title: 'Example',
            streamUrl: 'https://example.com/video.m3u8',
        });

        registry.attachCloser(session.id, close);

        await expect(registry.closeSession(session.id)).rejects.toThrow(
            'close failed'
        );

        expect(close).toHaveBeenCalled();
        expect(registry.getSession(session.id)?.status).toBe('launching');
        expect(registry.getSession(session.id)?.canClose).toBe(true);
        expect(registry.getActiveSessionId()).toBe(session.id);
    });

    it('marks runtime failures as errors without clearing the active id', () => {
        const session = registry.beginSession({
            player: 'mpv',
            title: 'Example',
            streamUrl: 'https://example.com/video.m3u8',
        });

        const errored = registry.markError(session.id, 'Failed to launch');

        expect(errored?.status).toBe('error');
        expect(errored?.error).toBe('Failed to launch');
        expect(registry.getActiveSessionId()).toBe(session.id);
    });

    it('does not overwrite terminal status with late lifecycle updates', () => {
        const failed = registry.beginSession({
            player: 'mpv',
            title: 'Failed',
            streamUrl: 'https://example.com/failed.m3u8',
        });
        registry.markError(failed.id, 'Failed to launch');

        expect(registry.markOpened(failed.id)?.status).toBe('error');

        const closed = registry.beginSession({
            player: 'vlc',
            title: 'Closed',
            streamUrl: 'https://example.com/closed.m3u8',
        });
        registry.markClosed(closed.id);

        expect(registry.markPlaying(closed.id)?.status).toBe('closed');
        expect(
            registry.markError(closed.id, 'Late process exit')?.status
        ).toBe('closed');
        expect(updates.at(-1)).toMatchObject({
            id: closed.id,
            status: 'closed',
        });
    });

    it('keeps confirmed playback ahead of a late opened acknowledgement', () => {
        const session = registry.beginSession({
            player: 'mpv',
            title: 'Fast playback',
            streamUrl: 'https://example.com/fast.m3u8',
        });

        expect(registry.markPlaying(session.id)?.status).toBe('playing');
        expect(registry.markOpened(session.id)?.status).toBe('playing');
    });

    it('restores a previous live session after a replacement fails', () => {
        const previous = registry.beginSession({
            player: 'mpv',
            title: 'Previous',
            streamUrl: 'https://example.com/previous.m3u8',
        });
        registry.attachCloser(previous.id, jest.fn());
        registry.markOpened(previous.id);
        const replacement = registry.beginSession({
            player: 'mpv',
            title: 'Replacement',
            streamUrl: 'https://example.com/replacement.m3u8',
        });
        registry.markError(replacement.id, 'teardown unconfirmed');

        const restored = registry.restoreActiveSession(
            previous.id,
            replacement.id
        );

        expect(restored).toMatchObject({
            id: previous.id,
            status: 'opened',
            canClose: true,
        });
        expect(registry.getActiveSessionId()).toBe(previous.id);
        expect(updates.at(-1)).toMatchObject({
            id: previous.id,
            restoredFromSessionId: replacement.id,
        });
    });

    it('does not restore over a newer active session', () => {
        const previous = registry.beginSession({
            player: 'mpv',
            title: 'Previous',
            streamUrl: 'https://example.com/previous.m3u8',
        });
        registry.markOpened(previous.id);
        const failedReplacement = registry.beginSession({
            player: 'mpv',
            title: 'Failed replacement',
            streamUrl: 'https://example.com/failed.m3u8',
        });
        const newer = registry.beginSession({
            player: 'vlc',
            title: 'Newer',
            streamUrl: 'https://example.com/newer.m3u8',
        });
        const updateCount = updates.length;

        expect(
            registry.restoreActiveSession(previous.id, failedReplacement.id)
        ).toBeNull();
        expect(registry.getActiveSessionId()).toBe(newer.id);
        expect(updates).toHaveLength(updateCount);
    });

    it('does not restore an unclosable terminal error session', () => {
        const terminal = registry.beginSession({
            player: 'mpv',
            title: 'Terminal failure',
            streamUrl: 'https://example.com/terminal.m3u8',
        });
        registry.markError(terminal.id, 'No player process remains');
        const replacement = registry.beginSession({
            player: 'vlc',
            title: 'Replacement',
            streamUrl: 'https://example.com/replacement.m3u8',
        });
        const updateCount = updates.length;

        expect(
            registry.restoreActiveSession(terminal.id, replacement.id)
        ).toBeNull();
        expect(registry.getActiveSessionId()).toBe(replacement.id);
        expect(updates).toHaveLength(updateCount);
    });
});
