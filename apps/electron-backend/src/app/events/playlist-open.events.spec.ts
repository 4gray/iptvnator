import {
    ACKNOWLEDGE_PLAYLIST_OPEN_REQUEST,
    ANNOUNCE_PLAYLIST_OPEN_LISTENER,
    OPEN_FILE,
} from '@iptvnator/shared/interfaces';

type IpcHandler = (event: MockIpcEvent, ...args: unknown[]) => unknown;

type MockIpcEvent = {
    sender: {
        isDestroyed: jest.Mock<boolean, []>;
        send: jest.Mock;
    };
};

const mockRegisteredHandlers = new Map<string, IpcHandler>();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn((channel: string, handler: IpcHandler) => {
            mockRegisteredHandlers.set(channel, handler);
        }),
    },
}));

function createEvent(isDestroyed = false): MockIpcEvent {
    return {
        sender: {
            isDestroyed: jest.fn(() => isDestroyed),
            send: jest.fn(),
        },
    };
}

const startupRequest = {
    fileName: 'startup.m3u',
    filePath: '/tmp/startup.m3u',
    requestId: 'startup-1',
};

describe('PlaylistOpenEvents', () => {
    let playlistOpenRequests: typeof import('../services/playlist-open-request').playlistOpenRequests;
    let announceListener: IpcHandler;
    let acknowledge: IpcHandler;

    beforeEach(async () => {
        jest.resetModules();
        mockRegisteredHandlers.clear();

        ({ playlistOpenRequests } = await import(
            '../services/playlist-open-request'
        ));
        const { default: PlaylistOpenEvents } = await import(
            './playlist-open.events'
        );

        PlaylistOpenEvents.bootstrapPlaylistOpenEvents();
        announceListener = mockRegisteredHandlers.get(
            ANNOUNCE_PLAYLIST_OPEN_LISTENER
        ) as IpcHandler;
        acknowledge = mockRegisteredHandlers.get(
            ACKNOWLEDGE_PLAYLIST_OPEN_REQUEST
        ) as IpcHandler;
    });

    it('registers the announcement and acknowledgement handlers', () => {
        expect(announceListener).toBeDefined();
        expect(acknowledge).toBeDefined();
    });

    it('pushes requests queued before the renderer was ready', () => {
        playlistOpenRequests.enqueue(startupRequest);
        const event = createEvent();

        announceListener(event);

        expect(event.sender.send).toHaveBeenCalledWith(
            OPEN_FILE,
            startupRequest
        );
        expect(playlistOpenRequests.pendingRequests).toEqual([]);
        expect(playlistOpenRequests.unacknowledgedRequests).toEqual([
            startupRequest,
        ]);
    });

    it('drops a request once the renderer acknowledges it', () => {
        playlistOpenRequests.enqueue(startupRequest);
        announceListener(createEvent());

        acknowledge(createEvent(), startupRequest.requestId);

        expect(playlistOpenRequests.unacknowledgedRequests).toEqual([]);
    });

    // A reload keeps the WebContents alive, so the push "succeeds" while the
    // new document never sees it. The replay is what saves the file.
    it('replays a request the renderer never acknowledged', () => {
        playlistOpenRequests.enqueue(startupRequest);
        announceListener(createEvent());

        const reloadedEvent = createEvent();
        announceListener(reloadedEvent);

        expect(reloadedEvent.sender.send).toHaveBeenCalledWith(
            OPEN_FILE,
            startupRequest
        );
    });

    it('pushes later requests to the renderer that announced itself', () => {
        const event = createEvent();

        announceListener(event);
        const liveRequest = {
            fileName: 'second-launch.m3u',
            filePath: '/tmp/second-launch.m3u',
            requestId: 'second-launch-1',
        };
        playlistOpenRequests.enqueue(liveRequest);

        expect(event.sender.send).toHaveBeenCalledWith(OPEN_FILE, liveRequest);
    });

    // A renderer that dies must not take the queued files with it: nothing
    // leaves the queue before its push succeeded, so the next renderer to
    // announce itself still receives them.
    it('keeps requests queued when the announcing renderer is gone', () => {
        playlistOpenRequests.enqueue(startupRequest);
        const deadEvent = createEvent(true);

        announceListener(deadEvent);

        expect(deadEvent.sender.send).not.toHaveBeenCalled();
        expect(playlistOpenRequests.pendingRequests).toEqual([startupRequest]);

        const nextEvent = createEvent();
        announceListener(nextEvent);

        expect(nextEvent.sender.send).toHaveBeenCalledWith(
            OPEN_FILE,
            startupRequest
        );
    });

    it('keeps a request queued when the push itself throws', () => {
        playlistOpenRequests.enqueue(startupRequest);
        const event = createEvent();
        event.sender.send.mockImplementation(() => {
            throw new Error('Object has been destroyed');
        });

        expect(() => announceListener(event)).not.toThrow();
        expect(playlistOpenRequests.pendingRequests).toEqual([startupRequest]);
    });
});
