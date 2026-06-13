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

    it('marks protected playback without exposing request credentials', () => {
        const session = registry.beginSession({
            player: 'mpv',
            title: 'Header protected stream',
            streamUrl: 'https://example.com/video.m3u8',
            requiresRequestHeaders: true,
        });

        expect(session).toEqual(
            expect.objectContaining({
                requiresRequestHeaders: true,
            })
        );
        expect(session).not.toHaveProperty('headers');
        expect(session).not.toHaveProperty('userAgent');
        expect(session).not.toHaveProperty('referer');
        expect(session).not.toHaveProperty('origin');
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

    it('marks a session closed without swallowing close failures', async () => {
        const session = registry.beginSession({
            player: 'vlc',
            title: 'Example',
            streamUrl: 'https://example.com/video.m3u8',
        });
        registry.attachCloser(session.id, () => {
            throw new Error('close failed');
        });

        await expect(registry.closeSession(session.id)).rejects.toThrow(
            'close failed'
        );
        expect(registry.getSession(session.id)?.status).toBe('closed');
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
