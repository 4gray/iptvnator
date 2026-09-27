import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MockPipe } from 'ng-mocks';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import {
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
    ResizableDirective,
} from '@iptvnator/portal/shared/util';
import {
    FavoritesService,
    XtreamStore,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    EpgArchiveCopyService,
    EpgArchiveDownloadService,
    EpgListViewComponent,
    EpgTimelineComponent,
} from '@iptvnator/ui/epg';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { GridListComponent } from '@iptvnator/portal/shared/ui';
import {
    DatabaseService,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import {
    playlist,
    sampleChannel,
    StubEpgTimelineComponent,
    StubGridListComponent,
    StubPortalChannelsListComponent,
    StubResizableDirective,
    StubWebPlayerViewComponent,
} from './live-stream-layout-stubs.spec-data';

/**
 * Parental lock: a relock stops the channel playing from a now-withheld
 * category. Split from `live-stream-layout.component.spec.ts`, which sits at
 * the spec line cap.
 */
describe('LiveStreamLayoutComponent parental lock', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    const emptyList = signal<unknown[]>([]);
    const parentalLock = {
        version: signal(0),
        active: signal(false),
        isXtreamCategoryLocked: jest.fn(() => false),
    };
    const databaseService = {
        getAllXtreamCategories: jest.fn(async () => [] as unknown[]),
    };
    const runtime = { supportsXtreamSqliteDataSource: false };
    const xtreamStore = {
        getCategoriesBySelectedType: signal([
            { category_id: 1, category_name: 'News' },
        ]),
        liveCategories: signal([{ id: 41, xtream_id: 7, name: 'Adult' }]),
        getCategoryItemCounts: signal(new Map<number, number>([[1, 1]])),
        getPaginatedContent: emptyList,
        hasMoreContent: signal(false),
        epgItems: emptyList,
        currentEpgItem: signal(null),
        isLoadingEpg: signal(false),
        selectedTypeContentLoading: signal(false),
        selectedCategoryId: signal<number | null>(1),
        selectedContentType: signal('live'),
        selectedItem: signal(null),
        currentPlaylist: signal(playlist),
        liveStreams: emptyList,
        isContentInitialized: signal(true),
        selectItemsFromSelectedCategory: jest.fn(() => []),
        constructStreamUrl: jest.fn(() => 'https://example.com/live.ts'),
        openPlayer: jest.fn(),
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
        loadMoreContent: jest.fn(),
    };

    beforeEach(async () => {
        parentalLock.version.set(0);
        parentalLock.active.set(false);
        parentalLock.isXtreamCategoryLocked.mockReset();
        parentalLock.isXtreamCategoryLocked.mockReturnValue(false);
        databaseService.getAllXtreamCategories.mockReset();
        databaseService.getAllXtreamCategories.mockResolvedValue([]);
        runtime.supportsXtreamSqliteDataSource = false;

        await TestBed.configureTestingModule({
            imports: [LiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: EpgArchiveDownloadService,
                    useValue: { start: jest.fn() },
                },
                {
                    provide: EpgArchiveCopyService,
                    useValue: { copy: jest.fn() },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({}),
                        },
                        queryParamMap: of(convertToParamMap({})),
                        pathFromRoot: [
                            { snapshot: { data: { layout: 'workspace' } } },
                        ],
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        events: new Subject().asObservable(),
                        navigate: jest.fn(),
                    },
                },
                { provide: XtreamStore, useValue: xtreamStore },
                {
                    provide: FavoritesService,
                    useValue: { getFavorites: jest.fn(() => of([])) },
                },
                {
                    provide: XtreamUrlService,
                    useValue: {
                        constructAutoLiveTsUrl: jest.fn(() => undefined),
                        resolveCatchupUrl: jest.fn(),
                    },
                },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                { provide: DatabaseService, useValue: databaseService },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openExternalPlayback: jest.fn(),
                    },
                },
                { provide: ParentalLockService, useValue: parentalLock },
            ],
        })
            .overrideComponent(LiveStreamLayoutComponent, {
                remove: {
                    imports: [
                        EpgListViewComponent,
                        EpgTimelineComponent,
                        GridListComponent,
                        PortalChannelsListComponent,
                        ResizableDirective,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubEpgTimelineComponent,
                        StubGridListComponent,
                        StubPortalChannelsListComponent,
                        StubResizableDirective,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                        StubWebPlayerViewComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        TestBed.inject(LiveLayoutSidebarStateService).setState(
            'portal',
            'expanded'
        );
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    function lock(categoryId: number): void {
        parentalLock.active.set(true);
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_playlistId: string, _type: string, id: number) =>
                id === categoryId
        );
        parentalLock.version.update((value) => value + 1);
        fixture.detectChanges();
    }

    it('stops the playing channel once its category is withheld', () => {
        component.playLive({ ...sampleChannel, category_id: 7 });
        expect(component.activePlayback()).not.toBeNull();

        // Locks edited while unlocked: nothing is withheld yet.
        parentalLock.version.update((value) => value + 1);
        fixture.detectChanges();
        expect(component.activePlayback()).not.toBeNull();

        lock(7);

        expect(parentalLock.isXtreamCategoryLocked).toHaveBeenCalledWith(
            'playlist-1',
            'live',
            7
        );
        expect(component.activePlayback()).toBeNull();
        expect(component.playbackSessionKey()).toBe('');
    });

    it('keeps a channel from an unlocked category playing', () => {
        component.playLive({ ...sampleChannel, category_id: 3 });

        lock(7);

        expect(component.activePlayback()).not.toBeNull();
    });

    it('resolves a hidden category through the unfiltered rows before judging it', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        // Row 99 is hidden: absent from liveCategories, present in the
        // unfiltered table with provider id 9.
        databaseService.getAllXtreamCategories.mockResolvedValue([
            { id: 99, xtream_id: 9 },
        ]);
        component.playLive({ ...sampleChannel, category_id: 99 });
        await fixture.whenStable();

        expect(databaseService.getAllXtreamCategories).toHaveBeenCalledWith(
            'playlist-1',
            'live'
        );
        lock(7);
        expect(component.activePlayback()).not.toBeNull();

        lock(9);
        expect(component.activePlayback()).toBeNull();
    });

    it('ignores a hidden-category lookup that lands after a later playback', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        let resolveLookup: (rows: unknown[]) => void = () => undefined;
        databaseService.getAllXtreamCategories.mockReturnValueOnce(
            new Promise<unknown[]>((resolve) => (resolveLookup = resolve))
        );
        // Playlist 1: hidden category 99, lookup in flight.
        component.playLive({ ...sampleChannel, category_id: 99 });

        // Playlist 2: a channel with the same provider id whose category is
        // visible (row 41 → provider 7) resolves synchronously.
        xtreamStore.currentPlaylist.set({ ...playlist, id: 'playlist-2' });
        fixture.detectChanges();
        component.playLive({ ...sampleChannel, category_id: 41 });
        expect(component.activePlayback()).not.toBeNull();

        // The stale lookup answers for playlist 1 with provider 9.
        resolveLookup([{ id: 99, xtream_id: 9 }]);
        await fixture.whenStable();

        lock(9);
        expect(component.activePlayback()).not.toBeNull();
        lock(7);
        expect(component.activePlayback()).toBeNull();
        xtreamStore.currentPlaylist.set(playlist);
    });

    it('stops a channel whose category is still unresolved when the lock activates', () => {
        runtime.supportsXtreamSqliteDataSource = true;
        databaseService.getAllXtreamCategories.mockReturnValue(
            new Promise(() => undefined)
        );
        component.playLive({ ...sampleChannel, category_id: 99 });

        lock(7);

        expect(component.activePlayback()).toBeNull();
    });

    it('maps the SQLite category row id to the provider id it is locked by', () => {
        runtime.supportsXtreamSqliteDataSource = true;
        component.playLive({ ...sampleChannel, category_id: 41 });

        lock(7);

        expect(component.activePlayback()).toBeNull();
    });
});
