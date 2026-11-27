import { Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { NotificationService } from '@iptvnator/services/notifications';
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
                        refreshLive: async () => (replaced ? 42 : false),
                    },
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
        .mockResolvedValue(42);
    const dispatch = jest.fn();
    const error = jest.fn();
    const injector = Injector.create({
        providers: [
            {
                provide: XtreamStartupRefreshService,
                useValue: { refreshLive },
            },
            { provide: Store, useValue: { dispatch } },
            { provide: NotificationService, useValue: { error } },
        ],
    });
    try {
        await refreshXtreamPlaylistsOnStartup(injector, [source, portal]);
        expect(refreshLive.mock.calls).toEqual([[source], [portal]]);
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ playlistId: portal._id, updateDate: 42 })
        );
        expect(error).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.XTREAM_STARTUP_REFRESH_FAILED'
        );
    } finally {
        injector.destroy();
    }
});

it('does not publish an update superseded before catalog completion', async () => {
    const dispatch = jest.fn();
    const injector = Injector.create({
        providers: [
            {
                provide: XtreamStartupRefreshService,
                useValue: { refreshLive: async () => false },
            },
            { provide: Store, useValue: { dispatch } },
        ],
    });
    try {
        await refreshXtreamPlaylistsOnStartup(injector, [source]);
        expect(dispatch).not.toHaveBeenCalled();
    } finally {
        injector.destroy();
    }
});
