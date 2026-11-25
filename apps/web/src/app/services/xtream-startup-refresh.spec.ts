import { Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';
import { NotificationService } from '@iptvnator/services/notifications';
import { PlaylistsService } from '@iptvnator/services';
import { XtreamStartupRefreshService } from '@iptvnator/services/xtream-startup-refresh';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { refreshXtreamPlaylistsOnStartup } from './xtream-startup-refresh';

const source: PlaylistMeta = {
    _id: 'source',
    title: 'Sample source',
    autoRefresh: true,
    count: 0,
    importDate: '2026-01-01',
};

it.each([true, false])(
    'invalidates open favorites and history only after a catalog replacement (%s)',
    async (replaced) => {
        const injector = Injector.create({
            providers: [
                {
                    provide: XtreamStartupRefreshService,
                    useValue: {
                        refreshLive: async () => replaced,
                        recordUpdate: () => undefined,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { updatePlaylistMetaIfCurrent: () => of(source) },
                },
                { provide: Store, useValue: { dispatch: () => undefined } },
            ],
        });
        let favoriteRefreshes = 0;
        let historyRefreshes = 0;
        const favoritesChanged = () => favoriteRefreshes++;
        const historyChanged = () => historyRefreshes++;
        window.addEventListener(
            'iptvnator-favorites-changed',
            favoritesChanged
        );
        window.addEventListener('iptvnator-history-changed', historyChanged);
        try {
            await refreshXtreamPlaylistsOnStartup(injector, [source]);
            expect(favoriteRefreshes).toBe(Number(replaced));
            expect(historyRefreshes).toBe(Number(replaced));
        } finally {
            window.removeEventListener(
                'iptvnator-favorites-changed',
                favoritesChanged
            );
            window.removeEventListener(
                'iptvnator-history-changed',
                historyChanged
            );
            injector.destroy();
        }
    }
);

it('continues after an unavailable source and publishes only a saved refresh', async () => {
    const portal = {
        ...source,
        _id: 'synthetic-live',
        serverUrl: 'https://provider.example',
        username: 'synthetic-user',
        password: 'synthetic-password',
        userAgent: 'Synthetic client',
    };
    const refreshLive = jest
        .fn()
        .mockRejectedValueOnce(new Error('Offline'))
        .mockResolvedValue(true);
    const recordUpdate = jest.fn();
    const dispatch = jest.fn();
    const error = jest.fn();
    const updatePlaylistMetaIfCurrent = jest.fn((_patch, matches) => {
        expect(matches(portal)).toBe(true);
        expect(matches({ ...portal, userAgent: 'Changed client' })).toBe(false);
        return of(portal);
    });
    const injector = Injector.create({
        providers: [
            {
                provide: XtreamStartupRefreshService,
                useValue: { refreshLive, recordUpdate },
            },
            {
                provide: PlaylistsService,
                useValue: { updatePlaylistMetaIfCurrent },
            },
            { provide: Store, useValue: { dispatch } },
            { provide: NotificationService, useValue: { error } },
        ],
    });
    try {
        await refreshXtreamPlaylistsOnStartup(injector, [source, portal]);
        expect(refreshLive.mock.calls).toEqual([[source], [portal]]);
        expect(updatePlaylistMetaIfCurrent).toHaveBeenCalledTimes(1);
        expect(recordUpdate).toHaveBeenCalledWith(
            portal._id,
            expect.any(Number)
        );
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ playlistId: portal._id })
        );
        expect(error).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.XTREAM_STARTUP_REFRESH_FAILED'
        );
    } finally {
        injector.destroy();
    }
});

it.each([
    ['open source', source, true],
    ['changed source', { ...source, userAgent: 'Changed client' }, false],
    ['newer source', { ...source, updateDate: 42 }, false],
])(
    'handles timestamp persistence failure for the %s',
    async (_label, current, publish) => {
        const recordUpdate = jest.fn();
        const dispatch = jest.fn();
        const error = jest.fn();
        const injector = Injector.create({
            providers: [
                {
                    provide: XtreamStartupRefreshService,
                    useValue: { refreshLive: async () => true, recordUpdate },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        updatePlaylistMetaIfCurrent: () =>
                            throwError(
                                () => new Error('Synthetic timestamp failure')
                            ),
                    },
                },
                {
                    provide: Store,
                    useValue: { dispatch, select: () => of([current]) },
                },
                { provide: NotificationService, useValue: { error } },
            ],
        });
        try {
            await refreshXtreamPlaylistsOnStartup(injector, [source]);
            expect(recordUpdate).toHaveBeenCalledTimes(Number(publish));
            expect(dispatch).toHaveBeenCalledTimes(Number(publish));
            if (publish)
                expect(dispatch).toHaveBeenCalledWith(
                    expect.objectContaining({
                        playlistId: source._id,
                        updateDate: expect.any(Number),
                    })
                );
            expect(error).toHaveBeenCalledTimes(1);
        } finally {
            injector.destroy();
        }
    }
);
