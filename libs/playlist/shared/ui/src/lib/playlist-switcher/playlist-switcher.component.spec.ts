import { signal } from '@angular/core';
import {
    ComponentFixture,
    TestBed,
    fakeAsync,
    flushMicrotasks,
    tick,
} from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlaylistContextFacade,
    PlaylistRefreshActionService,
} from '@iptvnator/playlist/shared/util';
import { DialogService } from 'components';
import { DatabaseService, PortalStatusService } from 'services';
import { PlaylistMeta } from 'shared-interfaces';
import { PlaylistSwitcherComponent } from './playlist-switcher.component';

const SEARCH_QUERY_STORAGE_KEY = 'playlist-switcher:search-query';
const PLAYLIST_TYPE_FILTER_STORAGE_KEY = 'playlist-switcher:type-filters';

function createPlaylist(
    overrides: Partial<PlaylistMeta> & { _id: string }
): PlaylistMeta {
    return {
        _id: overrides._id,
        title: overrides.title ?? overrides.filename ?? overrides._id,
        filename: overrides.filename,
        count: overrides.count ?? 0,
        importDate:
            overrides.importDate ?? new Date('2026-04-05T10:00:00.000Z').toISOString(),
        autoRefresh: overrides.autoRefresh ?? false,
        ...overrides,
    } as PlaylistMeta;
}

describe('PlaylistSwitcherComponent', () => {
    let fixture: ComponentFixture<PlaylistSwitcherComponent>;
    let component: PlaylistSwitcherComponent;
    let playlistsSignal: ReturnType<typeof signal<PlaylistMeta[]>>;
    let resolvedPlaylistIdSignal: ReturnType<typeof signal<string | null>>;
    let activePlaylistSignal: ReturnType<typeof signal<PlaylistMeta | null>>;
    let playlistContext: {
        playlists: typeof playlistsSignal;
        allPlaylistsLoaded: ReturnType<typeof signal<boolean>>;
        resolvedPlaylistId: typeof resolvedPlaylistIdSignal;
        activePlaylist: typeof activePlaylistSignal;
        selectPlaylist: jest.Mock;
    };
    let portalStatusService: {
        checkPortalStatus: jest.Mock;
        getStatusClass: jest.Mock;
    };
    let refreshActionService: {
        canRefresh: jest.Mock;
        refresh: jest.Mock;
    };
    let dialog: {
        open: jest.Mock;
    };
    let dialogService: {
        openConfirmDialog: jest.Mock;
    };
    let databaseService: {
        createOperationId: jest.Mock;
        deletePlaylist: jest.Mock;
    };
    let snackBar: {
        open: jest.Mock;
    };
    let store: {
        dispatch: jest.Mock;
    };

    const m3uPlaylist = createPlaylist({
        _id: 'm3u-1',
        count: 24,
        importDate: '2026-04-05T09:00:00.000Z',
        title: 'Morning M3U',
        url: 'http://example.test/m3u.m3u',
    });
    const stalkerPlaylist = createPlaylist({
        _id: 'stalker-1',
        importDate: '2026-04-05T11:00:00.000Z',
        macAddress: '00:1A:79:00:00:01',
        portalUrl: 'http://127.0.0.1:3210/portal.php',
        title: 'Living Room Stalker',
    });
    const xtreamPlaylist = createPlaylist({
        _id: 'xtream-1',
        importDate: '2026-04-05T12:00:00.000Z',
        password: 'pass1',
        serverUrl: 'http://127.0.0.1:3211',
        title: 'Cinema Xtream',
        updateDate: new Date('2026-04-05T12:30:00.000Z').getTime(),
        username: 'user1',
    });

    async function createComponent(): Promise<void> {
        await TestBed.configureTestingModule({
            imports: [
                PlaylistSwitcherComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: PlaylistContextFacade,
                    useValue: playlistContext,
                },
                {
                    provide: PortalStatusService,
                    useValue: portalStatusService,
                },
                {
                    provide: PlaylistRefreshActionService,
                    useValue: refreshActionService,
                },
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
                {
                    provide: DialogService,
                    useValue: dialogService,
                },
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: Store,
                    useValue: store,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(PlaylistSwitcherComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('currentTitle', '');
        fixture.componentRef.setInput('subtitle', '3 playlists');
        fixture.detectChanges();
    }

    beforeEach(() => {
        localStorage.clear();

        playlistsSignal = signal([m3uPlaylist, stalkerPlaylist, xtreamPlaylist]);
        resolvedPlaylistIdSignal = signal<string | null>(xtreamPlaylist._id);
        activePlaylistSignal = signal<PlaylistMeta | null>(xtreamPlaylist);

        playlistContext = {
            playlists: playlistsSignal,
            allPlaylistsLoaded: signal(true),
            resolvedPlaylistId: resolvedPlaylistIdSignal,
            activePlaylist: activePlaylistSignal,
            selectPlaylist: jest.fn((playlist: PlaylistMeta) => {
                resolvedPlaylistIdSignal.set(playlist._id);
                activePlaylistSignal.set(playlist);
            }),
        };
        portalStatusService = {
            checkPortalStatus: jest
                .fn()
                .mockResolvedValueOnce('active')
                .mockResolvedValueOnce('inactive'),
            getStatusClass: jest.fn((status: string) => `status-${status}`),
        };
        refreshActionService = {
            canRefresh: jest.fn(
                (playlist: PlaylistMeta) =>
                    Boolean(
                        playlist.serverUrl || playlist.url || playlist.filePath
                    )
            ),
            refresh: jest.fn(),
        };
        dialog = {
            open: jest.fn(),
        };
        dialogService = {
            openConfirmDialog: jest.fn(),
        };
        databaseService = {
            createOperationId: jest.fn(),
            deletePlaylist: jest.fn(),
        };
        snackBar = {
            open: jest.fn(),
        };
        store = {
            dispatch: jest.fn(),
        };
    });

    afterEach(() => {
        localStorage.clear();
        jest.restoreAllMocks();
    });

    it('reads persisted search and type filters on startup and filters playlists accordingly', async () => {
        localStorage.setItem(SEARCH_QUERY_STORAGE_KEY, 'room');
        localStorage.setItem(
            PLAYLIST_TYPE_FILTER_STORAGE_KEY,
            JSON.stringify({
                m3u: false,
                stalker: true,
                xtream: true,
            })
        );

        await createComponent();

        expect(component.searchQuery()).toBe('room');
        expect(component.isTypeFilterSelected('m3u')).toBe(false);
        expect(component.filteredPlaylists()).toEqual([stalkerPlaylist]);
    });

    it('sorts playlists by import date descending and prevents clearing the last enabled type filter', async () => {
        await createComponent();

        expect(component.filteredPlaylists().map((playlist) => playlist._id)).toEqual([
            xtreamPlaylist._id,
            stalkerPlaylist._id,
            m3uPlaylist._id,
        ]);

        component.togglePlaylistTypeFilter('m3u');
        component.togglePlaylistTypeFilter('stalker');
        expect(component.playlistTypeFilters()).toEqual({
            m3u: false,
            stalker: false,
            xtream: true,
        });

        component.togglePlaylistTypeFilter('xtream');
        expect(component.playlistTypeFilters()).toEqual({
            m3u: false,
            stalker: false,
            xtream: true,
        });
    });

    it('selects a playlist, closes the menu, and emits the selected id', async () => {
        await createComponent();

        const closeMenuSpy = jest.spyOn(component.menuTrigger(), 'closeMenu');
        const selectedIds: string[] = [];
        component.playlistSelected.subscribe((playlistId) => {
            selectedIds.push(playlistId);
        });

        component.selectPlaylist(stalkerPlaylist);
        fixture.detectChanges();

        expect(closeMenuSpy).toHaveBeenCalledTimes(1);
        expect(playlistContext.selectPlaylist).toHaveBeenCalledWith(
            stalkerPlaylist
        );
        expect(selectedIds).toEqual([stalkerPlaylist._id]);
        expect(component.isSelected(stalkerPlaylist)).toBe(true);
    });

    it('emits playlist and account info requests through the context actions', async () => {
        await createComponent();

        const closeMenuSpy = jest.spyOn(component.menuTrigger(), 'closeMenu');
        const playlistInfoSpy = jest.fn();
        const accountInfoSpy = jest.fn();
        component.playlistInfoRequested.subscribe(playlistInfoSpy);
        component.accountInfoRequested.subscribe(accountInfoSpy);

        component.requestPlaylistInfo();
        component.requestAccountInfo();

        expect(closeMenuSpy).toHaveBeenCalledTimes(2);
        expect(playlistInfoSpy).toHaveBeenCalledTimes(1);
        expect(accountInfoSpy).toHaveBeenCalledTimes(1);
    });

    it('opens the menu, syncs overlay width, and checks portal statuses for Xtream playlists', fakeAsync(async () => {
        await createComponent();

        const triggerElement = component.triggerElement().nativeElement;
        jest.spyOn(triggerElement, 'getBoundingClientRect').mockReturnValue({
            bottom: 0,
            height: 0,
            left: 0,
            right: 320,
            toJSON: () => ({}),
            top: 0,
            width: 320,
            x: 0,
            y: 0,
        });

        component.onMenuOpened();
        flushMicrotasks();
        tick();

        expect(component.isMenuOpen()).toBe(true);
        expect(
            document.documentElement.style.getPropertyValue(
                '--playlist-switcher-overlay-width'
            )
        ).toBe('400px');
        expect(portalStatusService.checkPortalStatus).toHaveBeenCalledTimes(1);
        expect(portalStatusService.checkPortalStatus).toHaveBeenCalledWith(
            xtreamPlaylist.serverUrl,
            xtreamPlaylist.username,
            xtreamPlaylist.password
        );
        expect(component.portalStatuses().get(xtreamPlaylist._id)).toBe('active');
        expect(component.getStatusClass(xtreamPlaylist._id)).toBe('status-active');

        component.onMenuClosed();
        expect(component.isMenuOpen()).toBe(false);
        expect(
            document.documentElement.style.getPropertyValue(
                '--playlist-switcher-overlay-width'
            )
        ).toBe('');
    }));

    it('falls back to the active playlist title when no explicit current title is provided', async () => {
        await createComponent();

        expect(component.displayTitle()).toBe('Cinema Xtream');

        resolvedPlaylistIdSignal.set(null);
        activePlaylistSignal.set(null);
        fixture.detectChanges();

        expect(component.displayTitle()).toBe('Select playlist');
    });
});
