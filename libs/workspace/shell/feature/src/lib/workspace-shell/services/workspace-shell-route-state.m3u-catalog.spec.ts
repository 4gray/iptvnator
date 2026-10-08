import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { M3uCatalogIndexService } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { WorkspaceStartupPreferencesService } from '@iptvnator/workspace/shell/util';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';

/**
 * Which M3U catalog sections the rail offers. The index the rail counts from
 * is empty while a playlist loads, and the store can still hold another
 * playlist's rows; neither may show up as this playlist's sections.
 */
describe('WorkspaceShellRouteStateService — M3U catalog sections', () => {
    const loading = signal(false);
    const rowsPlaylistId = signal<string | null>('pl-a');
    const counts = signal({ movie: 0, episode: 0 });
    const catalogTabs = signal<boolean | undefined>(true);
    const router = {
        url: '/workspace/playlists/pl-a/all',
        events: of(),
    };

    function service(): WorkspaceShellRouteStateService {
        return TestBed.inject(WorkspaceShellRouteStateService);
    }

    function sections(state: WorkspaceShellRouteStateService): string[] {
        return state
            .primaryContextLinks()
            .map((link) => link.section ?? '')
            .filter((section) => section === 'vod' || section === 'series');
    }

    beforeEach(() => {
        loading.set(false);
        rowsPlaylistId.set('pl-a');
        counts.set({ movie: 0, episode: 0 });
        catalogTabs.set(true);
        router.url = '/workspace/playlists/pl-a/all';

        TestBed.configureTestingModule({
            providers: [
                WorkspaceShellRouteStateService,
                { provide: Router, useValue: router },
                {
                    provide: Store,
                    useValue: { selectSignal: () => signal([]) },
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: { activePlaylist: signal(null) },
                },
                {
                    provide: WorkspaceStartupPreferencesService,
                    useValue: {
                        showDashboard: () => true,
                        persistLastRestorablePath: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        onLangChange: of(),
                        instant: (key: string) => key,
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsDownloads: false, isElectron: false },
                },
                {
                    provide: SettingsStore,
                    useValue: { m3uCatalogTabs: catalogTabs },
                },
                {
                    provide: M3uCatalogIndexService,
                    useValue: {
                        loading,
                        rowsPlaylistId,
                        index: () => ({ counts: counts() }),
                    },
                },
            ],
        });
    });

    it('offers each section only when the playlist has that kind', () => {
        counts.set({ movie: 3, episode: 0 });

        expect(sections(service())).toEqual(['vod']);
    });

    it('keeps the sections while the same playlist reloads', () => {
        // The index is empty during a load; without the last answer the
        // links blinked out on every reload, the Movies page included.
        counts.set({ movie: 3, episode: 5 });
        const state = service();
        expect(sections(state)).toEqual(['vod', 'series']);

        loading.set(true);
        counts.set({ movie: 0, episode: 0 });

        expect(sections(state)).toEqual(['vod', 'series']);
    });

    it('never lends one playlist the sections of another while loading', () => {
        counts.set({ movie: 3, episode: 5 });
        const state = service();
        expect(sections(state)).toEqual(['vod', 'series']);

        loading.set(true);
        state.currentUrl.set('/workspace/playlists/pl-b/all');

        expect(sections(state)).toEqual([]);
    });

    it('never reads the rows of one playlist as the counts of another', () => {
        // Off an M3U route the rail follows the active playlist, which can
        // change while the store still holds the last opened playlist's
        // rows — not loading, just not this playlist's.
        counts.set({ movie: 3, episode: 5 });
        const state = service();
        expect(sections(state)).toEqual(['vod', 'series']);

        state.currentUrl.set('/workspace/playlists/pl-b/all');

        expect(sections(state)).toEqual([]);

        rowsPlaylistId.set('pl-b');
        counts.set({ movie: 0, episode: 2 });

        expect(sections(state)).toEqual(['series']);
    });

    it('offers nothing when the sections are turned off', () => {
        counts.set({ movie: 3, episode: 5 });
        catalogTabs.set(false);

        expect(sections(service())).toEqual([]);
    });
});
