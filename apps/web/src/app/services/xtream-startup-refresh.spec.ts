import { Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
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
