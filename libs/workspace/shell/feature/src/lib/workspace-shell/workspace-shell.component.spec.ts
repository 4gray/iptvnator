import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import {
    FavoritesContextService,
    PORTAL_EXTERNAL_PLAYBACK,
} from '@iptvnator/portal/shared/util';
import { of } from 'rxjs';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    DownloadsService,
    PlaylistsService,
    SettingsStore,
} from 'services';
import { SettingsContextService } from '../workspace-context-panel/settings-context.service';
import { WorkspaceShellComponent } from './workspace-shell.component';
import { WORKSPACE_SHELL_ACTIONS } from './workspace-shell-actions';

class MockXtreamStore {
    readonly contentSortMode = signal<
        'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'
    >('date-desc');
    readonly getCategoryItemCounts = signal(new Map<number, number>());
    readonly recentItems = signal<any[]>([]);

    setContentSortMode = jest.fn();
    setSearchTerm = jest.fn();
    setCategorySearchTerm = jest.fn();
    reloadCategories = jest.fn();
}

describe('WorkspaceShellComponent action matrix', () => {
    beforeEach(() => {
        (window as any).electron = { platform: 'darwin' };

        const selectSignal = jest
            .fn()
            .mockReturnValueOnce(signal('Playlist A'))
            .mockReturnValueOnce(
                signal({
                    _id: 'pl-1',
                    serverUrl: 'http://example.com',
                    title: 'Playlist A',
                })
            )
            .mockReturnValueOnce(
                signal([
                    { _id: 'pl-1', serverUrl: 'http://example.com' },
                    { _id: 'pl-2', serverUrl: 'http://example.com' },
                ])
            );

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: Router,
                    useValue: {
                        url: '/workspace/xtreams/pl-1/vod',
                        events: of(
                            new NavigationEnd(
                                1,
                                '/workspace/xtreams/pl-1/vod',
                                '/workspace/xtreams/pl-1/vod'
                            )
                        ),
                        navigate: jest.fn(),
                        navigateByUrl: jest.fn(),
                        parseUrl: jest
                            .fn()
                            .mockReturnValue({ queryParams: {} }),
                        createUrlTree: jest.fn(),
                        isActive: jest.fn(),
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSignal,
                    },
                },
                {
                    provide: XtreamStore,
                    useClass: MockXtreamStore,
                },
                {
                    provide: DownloadsService,
                    useValue: {
                        downloads: signal([]),
                        clearCompleted: jest.fn().mockResolvedValue(undefined),
                        loadDownloads: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal(null),
                        visibleSession: signal(null),
                        dismissActiveSession: jest.fn(),
                        closeSession: jest.fn(),
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        showExternalPlaybackBar: signal(true),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        clearPortalRecentlyViewed: jest
                            .fn()
                            .mockReturnValue(of(undefined)),
                    },
                },
                {
                    provide: MatDialog,
                    useValue: {
                        open: jest.fn().mockReturnValue({
                            afterClosed: () => of(undefined),
                        }),
                    },
                },
                {
                    provide: FavoritesContextService,
                    useValue: {},
                },
                {
                    provide: SettingsContextService,
                    useValue: {},
                },
                {
                    provide: WORKSPACE_SHELL_ACTIONS,
                    useValue: {
                        openAddPlaylistDialog: jest.fn(),
                        openGlobalSearch: jest.fn(),
                        openGlobalRecent: jest.fn(),
                        openAccountInfo: jest.fn(),
                    },
                },
            ],
        });
    });

    it('shows manage categories action for xtream category sections', () => {
        const component = TestBed.runInInjectionContext(
            () => new WorkspaceShellComponent()
        );

        component.currentUrl.set('/workspace/xtreams/pl-1/vod');

        expect(component.canManageCategories()).toBe(true);
        expect(component.contextActionGroups().hasSectionActions).toBe(true);
    });

    it('shows cleanup action for recent sections', () => {
        const component = TestBed.runInInjectionContext(
            () => new WorkspaceShellComponent()
        );

        component.currentUrl.set('/workspace/stalker/pl-1/recent');

        expect(component.headerBulkAction()).toEqual(
            expect.objectContaining({
                icon: 'delete_sweep',
                tooltip: 'Clear recently viewed',
            })
        );
        expect(component.hasContextActions()).toBe(true);
    });
});
