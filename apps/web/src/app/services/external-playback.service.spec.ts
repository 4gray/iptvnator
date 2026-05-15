import { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { ExternalPlaybackService } from './external-playback.service';

describe('ExternalPlaybackService', () => {
    let listener:
        | ((session: ExternalPlayerSession) => void)
        | undefined;
    let closeExternalPlayerSession: jest.Mock;
    let service: ExternalPlaybackService;

    const createSession = (
        overrides: Partial<ExternalPlayerSession> = {}
    ): ExternalPlayerSession => ({
        id: 'session-1',
        player: 'mpv',
        status: 'launching',
        title: 'Example',
        streamUrl: 'https://example.com/video.m3u8',
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: 42,
            contentType: 'vod',
        },
        startedAt: '2026-03-07T10:00:00.000Z',
        updatedAt: '2026-03-07T10:00:00.000Z',
        canClose: true,
        ...overrides,
    });

    beforeEach(() => {
        listener = undefined;
        closeExternalPlayerSession = jest.fn().mockResolvedValue(null);

        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                onExternalPlayerSessionUpdate: jest.fn((callback) => {
                    listener = callback;
                    return () => undefined;
                }),
                closeExternalPlayerSession,
            },
        });

        service = new ExternalPlaybackService();
    });

    it('tracks the latest launch and hides dismissed sessions until the next launch', () => {
        const first = createSession();
        listener?.(first);

        expect(service.activeSession()).toEqual(first);
        expect(service.visibleSession()).toEqual(first);

        service.dismissActiveSession();
        expect(service.visibleSession()).toBeNull();

        const next = createSession({
            id: 'session-2',
            title: 'Another Example',
        });
        listener?.(next);

        expect(service.visibleSession()).toEqual(next);
    });

    it('matches only active non-error sessions to content info', () => {
        const playing = createSession({
            status: 'playing',
            updatedAt: '2026-03-07T10:00:05.000Z',
        });
        listener?.(playing);

        expect(
            service.findMatchingSession({
                playlistId: 'playlist-1',
                contentXtreamId: 42,
                contentType: 'vod',
            })
        ).toEqual(playing);

        listener?.(
            createSession({
                status: 'error',
                error: 'Launch failed',
                updatedAt: '2026-03-07T10:00:06.000Z',
            })
        );

        expect(
            service.findMatchingSession({
                playlistId: 'playlist-1',
                contentXtreamId: 42,
                contentType: 'vod',
            })
        ).toBeNull();
        expect(service.visibleSession()).toBeNull();
    });

    it('delegates close requests for closable sessions', async () => {
        const session = createSession({ status: 'opened' });
        listener?.(session);

        closeExternalPlayerSession.mockResolvedValue(
            createSession({
                ...session,
                status: 'closed',
                canClose: false,
                updatedAt: '2026-03-07T10:00:10.000Z',
            })
        );

        await service.closeActiveSession();

        expect(closeExternalPlayerSession).toHaveBeenCalledWith(session.id);
        expect(service.visibleSession()).toBeNull();
    });

    it('can close a specific session directly', async () => {
        const session = createSession({ id: 'session-2', status: 'playing' });

        closeExternalPlayerSession.mockResolvedValue(
            createSession({
                ...session,
                status: 'closed',
                canClose: false,
                updatedAt: '2026-03-07T10:00:12.000Z',
            })
        );

        await service.closeSession(session);

        expect(closeExternalPlayerSession).toHaveBeenCalledWith('session-2');
    });

    it('hides terminal sessions from the dock', () => {
        listener?.(createSession({ status: 'closed', canClose: false }));
        expect(service.visibleSession()).toBeNull();

        listener?.(
            createSession({
                id: 'session-3',
                status: 'error',
                error: 'Launch failed',
                canClose: false,
            })
        );
        expect(service.visibleSession()).toBeNull();
    });
});
