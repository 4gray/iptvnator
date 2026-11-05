import {
    createEnvironmentInjector,
    EnvironmentInjector,
    Injector,
    runInInjectionContext,
} from '@angular/core';
import type {
    ElectronBridgeApi,
    Playlist,
    PlaylistRefreshPayload,
} from '@iptvnator/shared/interfaces';

import { PlaylistRefreshService } from './playlist-refresh.service';

describe('PlaylistRefreshService', () => {
    const originalElectron = window.electron;
    const payload: PlaylistRefreshPayload = {
        operationId: 'playlist-refresh-cancelled',
        playlistId: 'playlist-1',
        title: 'Large playlist',
        url: 'http://127.0.0.1/large.m3u',
    };

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: originalElectron,
            writable: true,
        });
    });

    it('creates a renderer-local AbortError from a cancellation result', async () => {
        const unsubscribe = jest.fn();
        const electron = {
            onPlaylistRefreshEvent: jest.fn(() => unsubscribe),
            refreshPlaylist: jest.fn().mockResolvedValue({
                operationId: payload.operationId,
                type: 'playlist-refresh-cancelled',
            }),
        } as unknown as ElectronBridgeApi;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: electron,
            writable: true,
        });

        await expect(
            runInInjectionContext(
                createEnvironmentInjector(
                    [],
                    Injector.NULL as unknown as EnvironmentInjector
                ),
                () => new PlaylistRefreshService()
            ).refreshPlaylist(payload)
        ).rejects.toMatchObject({
            message:
                'Playlist refresh "playlist-refresh-cancelled" was cancelled',
            name: 'AbortError',
        });
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, 'Captured agent'])(
        'retains the request User-Agent even when the worker result omits it (%s)',
        async (userAgent) => {
            Object.defineProperty(window, 'electron', {
                configurable: true,
                writable: true,
                value: {
                    refreshPlaylist: jest
                        .fn()
                        .mockResolvedValue({
                            _id: payload.playlistId,
                            playlist: { items: [] },
                        } as unknown as Playlist),
                },
            });
            const result = await runInInjectionContext(
                createEnvironmentInjector(
                    [],
                    Injector.NULL as unknown as EnvironmentInjector
                ),
                () => new PlaylistRefreshService()
            ).refreshPlaylist({ ...payload, userAgent });
            expect(result).toHaveProperty('userAgent', userAgent);
        }
    );
});
