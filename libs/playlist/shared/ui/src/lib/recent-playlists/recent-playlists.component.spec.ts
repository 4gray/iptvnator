import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import {
    PlaylistActions,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import {
    PlaylistContextFacade,
    SourcesViewStateService,
} from '@iptvnator/playlist/shared/util';
import {
    RuntimeCapabilitiesService,
    SortBy,
    SortOptions,
    SortOrder,
    SortService,
    SourceActivityService,
} from '@iptvnator/services';
import { PlaylistMeta, SourceStatus } from '@iptvnator/shared/interfaces';
import { PlaylistRefreshActionService } from '../playlist-refresh-action.service';
import { SourceRemovalService } from '../source-removal/source-removal.service';
import { SourceRowComponent } from '../source-row/source-row.component';
import { RecentPlaylistsComponent } from './recent-playlists.component';
import { SourceListRefreshService } from './source-list-refresh.service';

const source = (
    id: string,
    fields: Partial<PlaylistMeta> = {}
): PlaylistMeta => ({
    _id: id,
    title: id,
    count: 0,
    importDate: '2026-01-01T00:00:00.000Z',
    autoRefresh: false,
    ...fields,
});

const M3U = source('m3u', { url: 'https://cdn.example/list.m3u', position: 0 });
const XTREAM = source('xtream', {
    serverUrl: 'http://x.example',
    username: 'u',
    password: 'p',
    position: 1,
});
const FILE = source('file', { position: 2 });

describe('RecentPlaylistsComponent', () => {
    let fixture: ComponentFixture<RecentPlaylistsComponent>;
    let component: RecentPlaylistsComponent;
    let store: MockStore;
    let sort: BehaviorSubject<SortOptions>;
    let statuses: Map<string, SourceStatus>;
    let pending: ReturnType<typeof signal<ReadonlySet<string>>>;
    let removal: {
        pendingIds: typeof pending;
        remove: jest.Mock;
        isPending: jest.Mock;
        canTakeOver: jest.Mock;
        progress: object;
    };
    let viewState: SourcesViewStateService;
    let switcherRefreshing: ReturnType<typeof signal<string | null>>;

    beforeEach(() => {
        localStorage.clear();
        sort = new BehaviorSubject<SortOptions>({
            by: SortBy.CUSTOM,
            order: SortOrder.ASC,
        });
        statuses = new Map([
            ['m3u', { reachability: 'ok' }],
            ['xtream', { reachability: 'bad' }],
        ]);
        pending = signal<ReadonlySet<string>>(new Set());
        switcherRefreshing = signal<string | null>(null);
        removal = {
            pendingIds: pending,
            remove: jest.fn(),
            isPending: jest.fn((id: string) => pending().has(id)),
            canTakeOver: jest.fn(
                (id: string) =>
                    !(
                        removal.progress as {
                            isDeleting: (id: string) => boolean;
                        }
                    ).isDeleting(id) &&
                    !TestBed.inject(SourceActivityService).isBusy(id)
            ),
            progress: {
                isDeleting: () => false,
                message: () => '',
                progress: () => null,
                canCancel: () => false,
            },
        };
        TestBed.configureTestingModule({
            imports: [RecentPlaylistsComponent, TranslateModule.forRoot()],
            providers: [
                provideMockStore({
                    selectors: [
                        { selector: selectPlaylistsLoadingFlag, value: true },
                        {
                            selector: selectAllPlaylistsMeta,
                            value: [M3U, XTREAM, FILE],
                        },
                    ],
                }),
                {
                    provide: SortService,
                    useValue: {
                        getSortOptions: () => sort.asObservable(),
                        sortPlaylists: new SortService().sortPlaylists,
                    },
                },
                {
                    provide: SourceStatusService,
                    useValue: {
                        supportsStatusFilter: true,
                        statusOf: (p: PlaylistMeta) =>
                            statuses.get(p._id) ?? null,
                        tracks: (p: PlaylistMeta) => statuses.has(p._id),
                        ensureChecked: jest.fn(),
                        recheck: jest.fn(),
                    },
                },
                { provide: SourceRemovalService, useValue: removal },
                {
                    provide: PlaylistContextFacade,
                    useValue: { resolvedPlaylistId: signal('xtream') },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        isElectron: true,
                        supportsPlaylistRefresh: true,
                        supportsXtreamSqliteDataSource: true,
                    },
                },
                {
                    provide: PlaylistRefreshActionService,
                    useValue: {
                        isSourceBusy: (id: string) =>
                            switcherRefreshing() === id,
                    },
                },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                { provide: Router, useValue: { navigate: jest.fn() } },
            ],
        });
        TestBed.overrideComponent(RecentPlaylistsComponent, {
            set: {
                providers: [
                    {
                        provide: SourceListRefreshService,
                        useValue: {
                            isRefreshing: () => false,
                            canRefresh: () => true,
                            message: () => '',
                            progress: () => null,
                            canCancel: () => false,
                        },
                    },
                ],
            },
        });
        fixture = TestBed.createComponent(RecentPlaylistsComponent);
        component = fixture.componentInstance;
        store = TestBed.inject(MockStore);
        viewState = TestBed.inject(SourcesViewStateService);
        jest.spyOn(store, 'dispatch');
        fixture.detectChanges();
    });

    const ids = () => component.visiblePlaylists().map((p) => p._id);

    it('lists every source as a row in the chosen order', () => {
        expect(ids()).toEqual(['m3u', 'xtream', 'file']);
        expect(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                'app-source-row'
            ).length
        ).toBe(3);
    });

    it('checks the sources a saved status filter hides', () => {
        fixture.destroy();
        viewState.setStatus('ok');
        statuses.set('xtream', { reachability: 'unknown' });
        const ensureChecked = TestBed.inject(SourceStatusService)
            .ensureChecked as jest.Mock;
        ensureChecked.mockClear();

        const restarted = TestBed.createComponent(RecentPlaylistsComponent);
        restarted.detectChanges();
        TestBed.tick();

        expect(
            restarted.componentInstance.visiblePlaylists().map((p) => p._id)
        ).toEqual(['m3u']);
        // No row is on screen for it, yet its check runs, so it can join
        // the list once it answers.
        expect(ensureChecked.mock.calls.map(([p]) => p._id)).toContain(
            'xtream'
        );
        restarted.destroy();
    });

    it('sorts by the name it shows: the host for a URL-named source', () => {
        store.overrideSelector(selectAllPlaylistsMeta, [
            M3U,
            XTREAM,
            FILE,
            source('url', {
                title: 'get.php?username=a&password=b',
                url: 'http://zzz.example/get.php?username=a&password=b',
            }),
        ]);
        store.refreshState();
        sort.next({ by: SortBy.NAME, order: SortOrder.ASC });
        fixture.detectChanges();
        expect(ids()).toEqual(['file', 'm3u', 'xtream', 'url']);
    });

    it('hands over past a source whose delete is still running', () => {
        (
            removal.progress as { isDeleting: (id: string) => boolean }
        ).isDeleting = (id) => id === 'xtream';
        component.remove(M3U);
        expect(removal.remove).toHaveBeenCalledWith(M3U, FILE);
    });

    it('hands over past a source a refresh holds', () => {
        const release = TestBed.inject(SourceActivityService).begin(['xtream']);
        component.remove(M3U);
        expect(removal.remove).toHaveBeenCalledWith(M3U, FILE);
        release();
    });

    it('keeps a running delete on screen whatever the filters', () => {
        (
            removal.progress as { isDeleting: (id: string) => boolean }
        ).isDeleting = (id) => id === 'xtream';
        viewState.setType('m3u');
        fixture.detectChanges();
        expect(ids()).toEqual(['m3u', 'xtream', 'file']);
    });

    it('applies the type and status filters together', () => {
        viewState.setType('m3u');
        expect(ids()).toEqual(['m3u', 'file']);
        viewState.setStatus('ok');
        expect(ids()).toEqual(['m3u']);
        viewState.setType('all');
        viewState.setStatus('bad');
        expect(ids()).toEqual(['xtream']);
    });

    it('offers to reset filters when nothing matches', () => {
        viewState.setType('stalker');
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        expect(element.textContent).toContain('WORKSPACE.SOURCES.NO_MATCHES');
        element
            .querySelector<HTMLButtonElement>('.sources-empty__reset')
            ?.click();
        expect(viewState.filter()).toEqual({ type: 'all', status: 'all' });
    });

    it('puts failing sources first on request', () => {
        sort.next({
            by: SortBy.NAME,
            order: SortOrder.ASC,
            failingFirst: true,
        });
        expect(ids()).toEqual(['xtream', 'file', 'm3u']);
    });

    it('keeps a source busy while the switcher refreshes it', () => {
        switcherRefreshing.set('xtream');
        fixture.detectChanges();
        const rows = Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                'app-source-row'
            )
        );
        expect(
            rows.map((row) =>
                row
                    .querySelector('.source-row')
                    ?.classList.contains('source-row--busy')
            )
        ).toEqual([false, true, false]);
        // Its menu, and Remove with it, waits for the refresh to settle.
        expect(
            rows[1].querySelector<HTMLButtonElement>('.source-row__more')
                ?.disabled
        ).toBe(true);
    });

    it('offers no Refresh while something else holds a source', () => {
        const canRefresh = () =>
            fixture.debugElement
                .queryAll(By.directive(SourceRowComponent))
                .map((row) =>
                    (row.componentInstance as SourceRowComponent).canRefresh()
                );
        expect(canRefresh()).toEqual([true, true, true]);
        // The startup auto-refresh or an import: refresh() would refuse.
        const release = TestBed.inject(SourceActivityService).begin(['m3u']);
        fixture.detectChanges();
        expect(canRefresh()).toEqual([false, true, true]);
        release();
        fixture.detectChanges();
        expect(canRefresh()).toEqual([true, true, true]);
    });

    it('offers no Remove while something else holds a source', () => {
        const removable = () =>
            fixture.debugElement
                .queryAll(By.directive(SourceRowComponent))
                .map((row) =>
                    (row.componentInstance as SourceRowComponent).removable()
                );
        expect(removable()).toEqual([true, true, true]);
        // The startup auto-refresh, or a refresh from the switcher.
        const release = TestBed.inject(SourceActivityService).begin(['m3u']);
        fixture.detectChanges();
        expect(removable()).toEqual([false, true, true]);
        release();
    });

    it('hides sources whose delete is pending', () => {
        pending.set(new Set(['m3u']));
        expect(ids()).toEqual(['xtream', 'file']);
    });

    it('hands the active source over to the next row on delete', () => {
        component.remove(XTREAM);
        expect(removal.remove).toHaveBeenCalledWith(XTREAM, FILE);
        component.remove(FILE);
        expect(removal.remove).toHaveBeenLastCalledWith(FILE, XTREAM);
    });

    it('reorders the shown rows without moving the hidden ones', () => {
        viewState.setType('m3u');
        component.drop({ previousIndex: 1, currentIndex: 0 } as never);
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistPositions({
                positionUpdates: [
                    { id: 'file', changes: { position: 0 } },
                    { id: 'xtream', changes: { position: 1 } },
                    { id: 'm3u', changes: { position: 2 } },
                ],
            })
        );
    });
});
