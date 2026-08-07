import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { ContentHeroComponent } from '@iptvnator/ui/components';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import {
    Playlist,
    ResolvedPortalPlayback,
    VodDetailsItem,
    createStalkerVodItem,
} from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { StalkerCollectionDetailComponent } from './stalker-collection-detail.component';
import { StalkerInlineDetailComponent } from './stalker-inline-detail/stalker-inline-detail.component';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

@Component({
    selector: 'app-content-hero',
    standalone: true,
    template: '',
})
class StubContentHeroComponent {
    readonly isLoading = input(false);
}

@Component({
    selector: 'app-stalker-inline-detail',
    standalone: true,
    template: '',
})
class StubStalkerInlineDetailComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly categoryId = input<'vod' | 'series' | null>(null);
    readonly seriesItem = input<unknown>(null);
    readonly isSeries = input(false);
    readonly vodDetailsItem = input<VodDetailsItem | null>(null);
    readonly isFavorite = input(false);
    readonly playbackPosition = input<number | null>(null);
    readonly inlinePlayback = input<ResolvedPortalPlayback | null>(null);
    readonly externalPlayback = input<unknown>(null);
    readonly backClicked = output<void>();
    readonly playClicked = output<VodDetailsItem>();
    readonly resumeClicked = output<unknown>();
    readonly favoriteToggled = output<unknown>();
    readonly inlineTimeUpdated = output<unknown>();
    readonly inlinePlaybackClosed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly inlineExternalFallbackRequested = output<unknown>();
}

describe('StalkerCollectionDetailComponent', () => {
    let fixture: ComponentFixture<StalkerCollectionDetailComponent>;
    let currentPlaylist: ReturnType<typeof signal<Playlist | undefined>>;
    let selectedContentType: ReturnType<
        typeof signal<'vod' | 'itv' | 'series'>
    >;
    let selectedCategoryId: ReturnType<typeof signal<string | null>>;
    let selectedItem: ReturnType<typeof signal<unknown>>;
    let stalkerStore: {
        currentPlaylist: typeof currentPlaylist;
        selectedContentType: typeof selectedContentType;
        selectedCategoryId: typeof selectedCategoryId;
        selectedItem: typeof selectedItem;
        setCurrentPlaylist: jest.Mock;
        setSelectedContentType: jest.Mock;
        setSelectedCategory: jest.Mock;
        setSelectedItem: jest.Mock;
        refreshEmbeddedSeriesSelection: jest.Mock;
        addToFavorites: jest.Mock;
        removeFromFavorites: jest.Mock;
        createLinkToPlayVod: jest.Mock;
        resolveVodPlayback: jest.Mock;
    };
    let portalPlayer: {
        isEmbeddedPlayer: jest.Mock;
        openResolvedPlayback: jest.Mock;
        openExternalPlayback: jest.Mock;
    };
    let playbackPositions: {
        savePlaybackPosition: jest.Mock;
        getPlaybackPosition: jest.Mock;
        getSeriesPlaybackPositions: jest.Mock;
        getAllPlaybackPositions: jest.Mock;
        clearPlaybackPosition: jest.Mock;
    };
    let snackBar: { open: jest.Mock };
    let playlistsService: { getPlaylistById: jest.Mock };

    const playlist = {
        _id: 'stalker-1',
        title: 'Stalker Portal',
        portalUrl: 'http://portal.example/portal.php',
        macAddress: '00:1A:79:00:00:01',
        favorites: [],
    } as unknown as Playlist;

    beforeEach(async () => {
        currentPlaylist = signal<Playlist | undefined>(undefined);
        selectedContentType = signal<'vod' | 'itv' | 'series'>('vod');
        selectedCategoryId = signal<string | null>(null);
        selectedItem = signal<unknown>(null);
        stalkerStore = {
            currentPlaylist,
            selectedContentType,
            selectedCategoryId,
            selectedItem,
            setCurrentPlaylist: jest.fn(async (value: Playlist | undefined) => {
                currentPlaylist.set(value);
            }),
            setSelectedContentType: jest.fn(
                (value: 'vod' | 'itv' | 'series') => {
                    selectedContentType.set(value);
                }
            ),
            setSelectedCategory: jest.fn((value: string | null) => {
                selectedCategoryId.set(value);
            }),
            setSelectedItem: jest.fn((value: unknown) => {
                selectedItem.set(value);
            }),
            refreshEmbeddedSeriesSelection: jest.fn(async () => false),
            addToFavorites: jest.fn(),
            removeFromFavorites: jest.fn(),
            createLinkToPlayVod: jest.fn(),
            resolveVodPlayback: jest.fn(),
        };
        portalPlayer = {
            isEmbeddedPlayer: jest.fn(() => true),
            openResolvedPlayback: jest.fn(),
            openExternalPlayback: jest.fn(),
        };
        playbackPositions = {
            savePlaybackPosition: jest.fn(),
            getPlaybackPosition: jest.fn(async () => null),
            getSeriesPlaybackPositions: jest.fn(),
            getAllPlaybackPositions: jest.fn(),
            clearPlaybackPosition: jest.fn(),
        };
        snackBar = { open: jest.fn() };
        playlistsService = {
            getPlaylistById: jest.fn((playlistId: string) =>
                of({ ...playlist, _id: playlistId })
            ),
        };

        await TestBed.configureTestingModule({
            imports: [StalkerCollectionDetailComponent],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: stalkerStore,
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: portalPlayer,
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: playbackPositions,
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
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: playlistsService.getPlaylistById,
                        getPortalFavorites: jest.fn(() => of([])),
                    },
                },
            ],
        })
            .overrideComponent(StalkerCollectionDetailComponent, {
                remove: {
                    imports: [
                        ContentHeroComponent,
                        StalkerInlineDetailComponent,
                    ],
                },
                add: {
                    imports: [
                        StubContentHeroComponent,
                        StubStalkerInlineDetailComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(StalkerCollectionDetailComponent);
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('opens legacy VOD is_series favorites through the lazy VOD-series flow', async () => {
        fixture.componentRef.setInput(
            'item',
            buildCollectionItem({
                contentType: 'series',
                categoryId: 'series',
                stalkerItem: {
                    id: '1507',
                    title: 'Flagged Series',
                    category_id: 'series',
                    cmd: '/media/file_1507.mpg',
                    is_series: '1',
                },
            })
        );

        await settleDetail(fixture);

        expect(stalkerStore.setSelectedContentType).toHaveBeenLastCalledWith(
            'vod'
        );
        expect(stalkerStore.setSelectedCategory).toHaveBeenLastCalledWith(
            'vod'
        );
        expect(stalkerStore.setSelectedItem).toHaveBeenLastCalledWith(
            expect.objectContaining({
                id: '1507',
                is_series: true,
            })
        );
        expect(fixture.componentInstance.inlineDetail()).toEqual(
            expect.objectContaining({
                categoryId: 'vod',
                isSeries: true,
                vodDetailsItem: null,
            })
        );
    });

    it('keeps regular Stalker series favorites in regular series mode', async () => {
        fixture.componentRef.setInput(
            'item',
            buildCollectionItem({
                contentType: 'series',
                categoryId: 'series',
                stalkerItem: {
                    id: '30001',
                    series_id: '30001',
                    title: 'Regular Series',
                    category_id: 'series',
                },
            })
        );

        await settleDetail(fixture);

        expect(stalkerStore.setSelectedContentType).toHaveBeenLastCalledWith(
            'series'
        );
        expect(fixture.componentInstance.inlineDetail()).toEqual(
            expect.objectContaining({
                categoryId: 'series',
                isSeries: false,
                vodDetailsItem: null,
            })
        );
    });

    it('keeps embedded VOD series favorites in the embedded VOD-series path', async () => {
        fixture.componentRef.setInput(
            'item',
            buildCollectionItem({
                contentType: 'series',
                categoryId: 'series',
                stalkerItem: {
                    id: '20001',
                    title: 'Embedded Series',
                    category_id: 'series',
                    cmd: '/media/file_20001.mpg',
                    series: [1, 2],
                },
            })
        );

        await settleDetail(fixture);

        expect(stalkerStore.setSelectedContentType).toHaveBeenLastCalledWith(
            'vod'
        );
        expect(fixture.componentInstance.inlineDetail()).toEqual(
            expect.objectContaining({
                categoryId: 'vod',
                isSeries: false,
                vodDetailsItem: null,
            })
        );
        expect(
            fixture.componentInstance.inlineDetail().seriesItem?.series
        ).toEqual([1, 2]);
        // The snapshot renders immediately, but a background portal
        // re-fetch must be triggered so new episodes can appear.
        expect(stalkerStore.refreshEmbeddedSeriesSelection).toHaveBeenCalled();
    });

    it('shows newly released episodes when the background snapshot refresh patches the selection', async () => {
        fixture.componentRef.setInput(
            'item',
            buildCollectionItem({
                contentType: 'series',
                categoryId: 'series',
                stalkerItem: {
                    id: '20001',
                    title: 'Embedded Series',
                    category_id: 'series',
                    cmd: '/media/file_20001.mpg',
                    series: [1],
                },
            })
        );

        await settleDetail(fixture);
        expect(
            fixture.componentInstance.inlineDetail().seriesItem?.series
        ).toEqual([1]);

        // Simulate the store-side refresh completing with a fresh portal row.
        const current = selectedItem() as Record<string, unknown>;
        selectedItem.set({ ...current, series: [1, 2] });
        await settleDetail(fixture);

        expect(
            fixture.componentInstance.inlineDetail().seriesItem?.series
        ).toEqual([1, 2]);
    });

    it('plays regular VOD collection details inline for embedded players instead of using the legacy play wrapper', async () => {
        const sourceItem = {
            id: '1701',
            title: 'Collection Movie',
            category_id: 'vod',
            cmd: '/media/file_1701.mpg',
            info: {
                name: 'Collection Movie',
                movie_image: 'movie.jpg',
            },
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl: 'https://streams.example.test/movie.mp4',
            title: 'Collection Movie',
            thumbnail: 'movie.jpg',
        };
        stalkerStore.resolveVodPlayback.mockResolvedValue(playback);

        fixture.componentRef.setInput(
            'item',
            buildCollectionItem({
                contentType: 'movie',
                categoryId: 'vod',
                stalkerItem: sourceItem,
            })
        );

        await settleDetail(fixture);

        fixture.componentInstance.onVodPlay(
            createStalkerVodItem(sourceItem, playlist._id)
        );
        await settleDetail(fixture);

        expect(stalkerStore.resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_1701.mpg',
            'Collection Movie',
            'movie.jpg'
        );
        expect(stalkerStore.createLinkToPlayVod).not.toHaveBeenCalled();
        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(fixture.componentInstance.inlinePlayback()).toEqual(playback);
        const detail = fixture.debugElement.query(
            By.directive(StubStalkerInlineDetailComponent)
        ).componentInstance as StubStalkerInlineDetailComponent;
        expect(detail.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'stalker-1',
                contentId: '1701',
            })
        );
    });

    it('ignores a pending payload after the collection detail owner changes and lets the new owner commit', async () => {
        const pendingA = deferred<ResolvedPortalPlayback>();
        const pendingB = deferred<ResolvedPortalPlayback>();
        stalkerStore.resolveVodPlayback.mockImplementation((cmd: string) =>
            cmd.includes('1701') ? pendingA.promise : pendingB.promise
        );
        const itemA = buildCollectionItem({
            stalkerId: '1701',
            stalkerItem: buildVodSource('1701', 'Movie A'),
        });
        const itemB = buildCollectionItem({
            stalkerId: '1702',
            stalkerItem: buildVodSource('1702', 'Movie B'),
        });

        fixture.componentRef.setInput('item', itemA);
        await settleDetail(fixture);
        fixture.componentInstance.onVodPlay(
            createStalkerVodItem(itemA.stalkerItem as never, itemA.playlistId)
        );
        await Promise.resolve();

        fixture.componentRef.setInput('item', itemB);
        await settleDetail(fixture);
        pendingA.resolve({ streamUrl: 'https://streams.test/a.mp4' });
        await settleDetail(fixture);

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
        expect(snackBar.open).not.toHaveBeenCalled();
        expect(fixture.componentInstance.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'stalker-1',
                contentId: '1702',
            })
        );

        fixture.componentInstance.onVodPlay(
            createStalkerVodItem(itemB.stalkerItem as never, itemB.playlistId)
        );
        pendingB.resolve({ streamUrl: 'https://streams.test/b.mp4' });
        await settleDetail(fixture);

        expect(fixture.componentInstance.inlinePlayback()).toEqual({
            streamUrl: 'https://streams.test/b.mp4',
        });
    });

    it('suppresses a pending error after the collection playlist owner changes', async () => {
        const pending = deferred<ResolvedPortalPlayback>();
        stalkerStore.resolveVodPlayback.mockReturnValue(pending.promise);
        const source = buildVodSource('1701', 'Movie A');
        const itemA = buildCollectionItem({
            playlistId: 'stalker-1',
            stalkerId: '1701',
            stalkerItem: source,
        });
        const itemB = buildCollectionItem({
            playlistId: 'stalker-2',
            stalkerId: '1701',
            stalkerItem: { ...source },
        });

        fixture.componentRef.setInput('item', itemA);
        await settleDetail(fixture);
        fixture.componentInstance.onVodPlay(
            createStalkerVodItem(itemA.stalkerItem as never, itemA.playlistId)
        );
        await Promise.resolve();

        fixture.componentRef.setInput('item', itemB);
        await settleDetail(fixture);
        pending.reject(new Error('stale A failure'));
        await settleDetail(fixture);

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
        expect(snackBar.open).not.toHaveBeenCalled();
        expect(fixture.componentInstance.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'stalker-2',
                contentId: '1701',
            })
        );
    });

    it('keeps a pending request when the same canonical owner is refreshed with a new object', async () => {
        const pending = deferred<ResolvedPortalPlayback>();
        stalkerStore.resolveVodPlayback.mockReturnValue(pending.promise);
        const item = buildCollectionItem({
            stalkerId: '1701',
            stalkerItem: buildVodSource('1701', 'Movie A'),
        });

        fixture.componentRef.setInput('item', item);
        await settleDetail(fixture);
        fixture.componentInstance.onVodPlay(
            createStalkerVodItem(item.stalkerItem as never, item.playlistId)
        );
        await Promise.resolve();

        fixture.componentRef.setInput('item', {
            ...item,
            stalkerItem: { ...(item.stalkerItem as object) },
        });
        await settleDetail(fixture);
        pending.resolve({ streamUrl: 'https://streams.test/a.mp4' });
        await settleDetail(fixture);

        expect(fixture.componentInstance.inlinePlayback()).toEqual({
            streamUrl: 'https://streams.test/a.mp4',
        });
        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('does not load VOD playback position when the playlist id is missing', async () => {
        const playlistsService = TestBed.inject(PlaylistsService) as {
            getPlaylistById: jest.Mock;
        };
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                ...playlist,
                _id: '',
            })
        );

        fixture.componentRef.setInput(
            'item',
            buildCollectionItem({
                contentType: 'movie',
                categoryId: 'vod',
                stalkerItem: {
                    id: '1702',
                    title: 'Collection Movie Without Playlist',
                    category_id: 'vod',
                    cmd: '/media/file_1702.mpg',
                },
            })
        );

        await settleDetail(fixture);

        expect(playbackPositions.getPlaybackPosition).not.toHaveBeenCalled();
        expect(fixture.componentInstance.selectedVodPlaybackPosition()).toBe(
            null
        );
    });
});

function buildCollectionItem(
    overrides: Partial<UnifiedCollectionItem>
): UnifiedCollectionItem {
    return {
        uid: 'stalker::stalker-1::item-1',
        name: 'Item',
        contentType: 'movie',
        sourceType: 'stalker',
        playlistId: 'stalker-1',
        playlistName: 'Stalker Portal',
        stalkerId: 'item-1',
        ...overrides,
    };
}

function buildVodSource(id: string, title: string) {
    return {
        id,
        title,
        category_id: 'vod',
        cmd: `/media/file_${id}.mpg`,
        info: { name: title },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function settleDetail(
    fixture: ComponentFixture<StalkerCollectionDetailComponent>
): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
}
