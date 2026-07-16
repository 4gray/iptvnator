type IpcHandler = (...args: unknown[]) => Promise<unknown>;

const ipcHandlers = new Map<string, IpcHandler>();
const mockWebContentsFromId = jest.fn();
const mockService = {
    getSupport: jest.fn(),
    start: jest.fn(),
    getSession: jest.fn(),
    stop: jest.fn(),
    stopForOwner: jest.fn(),
    shutdown: jest.fn(),
    setFailureHandler: jest.fn(),
};

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn((channel: string, handler: IpcHandler) =>
            ipcHandlers.set(channel, handler)
        ),
    },
    webContents: { fromId: mockWebContentsFromId },
}));

jest.mock('../services/local-timeshift.service', () => ({
    LocalTimeshiftService: jest.fn(() => mockService),
}));

import {
    LOCAL_TIMESHIFT_GET_SUPPORT,
    LOCAL_TIMESHIFT_START,
    LOCAL_TIMESHIFT_STOP,
} from '@iptvnator/shared/interfaces';
import './local-timeshift.events';

const sender = {
    id: 42,
    once: jest.fn(),
};

function handler(channel: string): IpcHandler {
    const registered = ipcHandlers.get(channel);
    if (!registered) {
        throw new Error(`Missing IPC handler for ${channel}`);
    }
    return registered;
}

describe('local Timeshift IPC', () => {
    beforeEach(() => {
        for (const value of Object.values(mockService)) {
            value.mockReset();
        }
        mockService.getSupport.mockReturnValue({
            supported: true,
            engine: 'ffmpeg',
        });
    });

    it('reports FFmpeg support', async () => {
        await expect(handler(LOCAL_TIMESHIFT_GET_SUPPORT)({})).resolves.toEqual(
            { supported: true, engine: 'ffmpeg' }
        );
    });

    it('starts a renderer-owned live session with merged provider headers', async () => {
        const snapshot = {
            id: 'timeshift-1',
            playbackUrl: 'http://127.0.0.1:43100/token/index.m3u8',
            status: 'ready',
        };
        mockService.start.mockResolvedValue(snapshot);

        await expect(
            handler(LOCAL_TIMESHIFT_START)(
                { sender },
                {
                    playback: {
                        streamUrl: 'https://provider.example/live.ts',
                        title: 'Live news',
                        isLive: true,
                        headers: { Authorization: 'Bearer token' },
                        userAgent: 'IPTVnator',
                        referer: 'https://provider.example/',
                    },
                    maxDurationMinutes: 30,
                }
            )
        ).resolves.toEqual(snapshot);
        expect(mockService.start).toHaveBeenCalledWith({
            ownerId: '42',
            sourceUrl: 'https://provider.example/live.ts',
            requestHeaders: {
                Authorization: 'Bearer token',
                'User-Agent': 'IPTVnator',
                Referer: 'https://provider.example/',
            },
            maxDurationMinutes: 30,
            bufferDirectory: undefined,
        });
    });

    it('rejects catch-up and unsafe file URLs before starting FFmpeg', async () => {
        const start = handler(LOCAL_TIMESHIFT_START);

        await expect(
            start(
                { sender },
                {
                    playback: {
                        streamUrl: 'https://provider.example/archive.ts',
                        title: 'Catch-up',
                        isLive: false,
                    },
                    maxDurationMinutes: 30,
                }
            )
        ).rejects.toThrow('requires live playback');
        await expect(
            start(
                { sender },
                {
                    playback: {
                        streamUrl: 'file:///private/secret',
                        title: 'Local file',
                        isLive: true,
                    },
                    maxDurationMinutes: 30,
                }
            )
        ).rejects.toThrow('protocol is not supported');
        expect(mockService.start).not.toHaveBeenCalled();
    });

    it('stops only the calling renderer session and returns a closed snapshot', async () => {
        mockService.getSession.mockResolvedValue({
            id: 'timeshift-1',
            playbackUrl: 'http://127.0.0.1:43100/token/index.m3u8',
            status: 'ready',
        });
        mockService.stop.mockResolvedValue(undefined);

        await expect(
            handler(LOCAL_TIMESHIFT_STOP)({ sender }, 'timeshift-1')
        ).resolves.toEqual(
            expect.objectContaining({ id: 'timeshift-1', status: 'closed' })
        );
        expect(mockService.getSession).toHaveBeenCalledWith(
            'timeshift-1',
            '42'
        );
        expect(mockService.stop).toHaveBeenCalledWith('timeshift-1', '42');
    });

    it('cancels a renderer-owned start before a public session id exists', async () => {
        mockService.stopForOwner.mockResolvedValue(undefined);

        await expect(
            handler(LOCAL_TIMESHIFT_STOP)({ sender }, undefined)
        ).resolves.toBeNull();

        expect(mockService.stopForOwner).toHaveBeenCalledWith('42');
        expect(mockService.stop).not.toHaveBeenCalled();
    });

    it('treats stopping an already-finished session as idempotent', async () => {
        mockService.getSession.mockResolvedValue(undefined);

        await expect(
            handler(LOCAL_TIMESHIFT_STOP)({ sender }, 'timeshift-finished')
        ).resolves.toBeNull();

        expect(mockService.getSession).toHaveBeenCalledWith(
            'timeshift-finished',
            '42'
        );
        expect(mockService.stop).not.toHaveBeenCalled();
        expect(mockService.stopForOwner).not.toHaveBeenCalled();
    });
});
