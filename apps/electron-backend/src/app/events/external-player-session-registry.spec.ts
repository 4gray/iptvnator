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

    it('still closes the session when the player fails to close', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation();
        const failure = new Error('player already exited');
        const close = jest.fn().mockRejectedValue(failure);
        const session = registry.beginSession({
            player: 'mpv',
            title: 'Example',
            streamUrl: 'https://example.com/video.m3u8',
        });

        registry.attachCloser(session.id, close);

        const closed = await registry.closeSession(session.id);

        expect(closed?.status).toBe('closed');
        expect(closed?.canClose).toBe(false);
        expect(registry.getActiveSessionId()).toBeNull();
        // The reason must survive: the old `return` inside `finally` dropped it.
        expect(warn).toHaveBeenCalledWith(
            `Failed to close external player session ${session.id}:`,
            failure
        );

        warn.mockRestore();
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
});
