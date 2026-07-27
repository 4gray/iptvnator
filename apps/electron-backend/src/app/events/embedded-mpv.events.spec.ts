jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

const mockEmbeddedMpvService = {
    getSupport: jest.fn(),
    loadPlayback: jest.fn(),
    setPaused: jest.fn(),
};

const mockConsumeStalkerPlaybackContext = jest.fn();

jest.mock('../services/embedded-mpv-native.service', () => ({
    EmbeddedMpvNativeService: class {},
    embeddedMpvNativeService: mockEmbeddedMpvService,
}));

jest.mock('../services/stalker-playback-context.service', () => ({
    stalkerPlaybackContextService: {
        consume: mockConsumeStalkerPlaybackContext,
    },
}));

import { ipcMain } from 'electron';
import {
    EMBEDDED_MPV_LOAD_PLAYBACK,
    EMBEDDED_MPV_SET_PAUSED,
    EMBEDDED_MPV_SUPPORT,
} from '@iptvnator/shared/interfaces';
import './embedded-mpv.events';

function getIpcMainHandler(
    channel: string
): (...args: unknown[]) => Promise<unknown> {
    const handleMock = ipcMain.handle as unknown as jest.Mock;
    const calls = handleMock.mock.calls as Array<
        [string, (...args: unknown[]) => Promise<unknown>]
    >;
    const match = calls.find(
        ([registeredChannel]) => registeredChannel === channel
    );

    if (!match) {
        throw new Error(`Missing ipcMain handler for ${channel}`);
    }

    return match[1];
}

describe('EmbeddedMpvEvents IPC handlers', () => {
    beforeEach(() => {
        mockEmbeddedMpvService.getSupport.mockReset();
        mockEmbeddedMpvService.loadPlayback.mockReset();
        mockEmbeddedMpvService.setPaused.mockReset();
        mockConsumeStalkerPlaybackContext.mockReset();
    });

    it('forwards arguments to the native service and returns its result', async () => {
        const session = { id: 'session-1', status: 'paused' };
        mockEmbeddedMpvService.setPaused.mockReturnValue(session);

        const handler = getIpcMainHandler(EMBEDDED_MPV_SET_PAUSED);

        await expect(handler({}, 'session-1', true)).resolves.toEqual(session);
        expect(mockEmbeddedMpvService.setPaused).toHaveBeenCalledWith(
            'session-1',
            true
        );
    });

    it('logs in the main process and rethrows when the native service throws', async () => {
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation();

        try {
            mockEmbeddedMpvService.getSupport.mockImplementation(() => {
                throw new Error('addon failed to load');
            });

            const handler = getIpcMainHandler(EMBEDDED_MPV_SUPPORT);

            await expect(handler({})).rejects.toThrow('addon failed to load');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining(EMBEDDED_MPV_SUPPORT),
                expect.any(Error)
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('consumes a sender-bound context and strips renderer secrets and the ref before native playback', async () => {
        mockConsumeStalkerPlaybackContext.mockReturnValue({
            Authorization: 'Bearer main-token',
            Cookie: 'session=main-cookie',
            Origin: 'https://main.example',
            Referer: 'https://main.example/player/',
            'User-Agent': 'MainAgent/1.0',
        });
        const handler = getIpcMainHandler(EMBEDDED_MPV_LOAD_PLAYBACK);

        await handler({ sender: { id: 44 } }, 'embedded-session', {
            headers: {
                Authorization: 'Bearer renderer-token',
                Cookie: 'session=renderer-cookie',
            },
            origin: 'https://renderer.example',
            playbackContextRef: 'opaque-playback-context',
            referer: 'https://renderer.example/referrer',
            streamUrl: 'https://stream.example/live.m3u8',
            title: 'Managed stream',
            userAgent: 'RendererAgent/1.0',
        });

        expect(mockConsumeStalkerPlaybackContext).toHaveBeenCalledWith({
            contextRef: 'opaque-playback-context',
            senderId: 44,
            streamUrl: 'https://stream.example/live.m3u8',
        });
        expect(mockEmbeddedMpvService.loadPlayback).toHaveBeenCalledWith(
            'embedded-session',
            {
                headers: {
                    Authorization: 'Bearer main-token',
                    Cookie: 'session=main-cookie',
                    Origin: 'https://main.example',
                    Referer: 'https://main.example/player/',
                    'User-Agent': 'MainAgent/1.0',
                },
                origin: 'https://main.example',
                referer: 'https://main.example/player/',
                streamUrl: 'https://stream.example/live.m3u8',
                title: 'Managed stream',
                userAgent: 'MainAgent/1.0',
            }
        );
        const nativePayload =
            mockEmbeddedMpvService.loadPlayback.mock.calls[0][1];
        expect(JSON.stringify(nativePayload)).not.toMatch(
            /renderer-token|renderer-cookie|opaque-playback-context/
        );
    });

    it('fails invalid contexts closed and preserves legacy no-ref playback', async () => {
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation();
        const handler = getIpcMainHandler(EMBEDDED_MPV_LOAD_PLAYBACK);
        const legacyPlayback = {
            headers: { 'User-Agent': 'LegacyAgent/1.0' },
            streamUrl: 'https://stream.example/legacy.m3u8',
            title: 'Legacy stream',
        };

        try {
            mockConsumeStalkerPlaybackContext.mockReturnValue(null);
            await expect(
                handler({ sender: { id: 12 } }, 'embedded-session', {
                    ...legacyPlayback,
                    playbackContextRef: 'foreign-or-expired-context',
                })
            ).rejects.toThrow('invalid-playback-context');
            expect(mockEmbeddedMpvService.loadPlayback).not.toHaveBeenCalled();

            await expect(
                handler(
                    { sender: { id: 12 } },
                    'embedded-session',
                    legacyPlayback
                )
            ).resolves.toBeUndefined();
            expect(mockConsumeStalkerPlaybackContext).toHaveBeenCalledTimes(1);
            expect(mockEmbeddedMpvService.loadPlayback).toHaveBeenCalledWith(
                'embedded-session',
                legacyPlayback
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
