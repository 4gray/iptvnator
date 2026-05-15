import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import {
    FavoriteItem,
    EpgQueueService,
    FavoritesService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { SettingsStore } from '@iptvnator/services';
import { PortalChannelsListComponent } from './portal-channels-list.component';

function buildEpgItem(params: {
    id: string;
    title: string;
    start: string;
    stop: string;
    startTimestamp: number;
    stopTimestamp: number;
}) {
    return {
        id: params.id,
        epg_id: `epg-${params.id}`,
        title: params.title,
        description: `${params.title} description`,
        lang: 'en',
        start: params.start,
        end: params.stop,
        stop: params.stop,
        channel_id: 'channel-1',
        start_timestamp: String(params.startTimestamp),
        stop_timestamp: String(params.stopTimestamp),
    };
}

describe('PortalChannelsListComponent', () => {
    let fixture: ComponentFixture<PortalChannelsListComponent>;
    const selectedChannels = signal<unknown[]>([]);
    const selectedItem = signal<unknown>(null);
    const epgItems = signal<unknown[]>([]);
    const selectedTypeContentLoading = signal(true);
    const selectedContentType = signal('live');
    const currentPlaylist = signal<unknown>(null);
    const selectedCategoryId = signal<number | null>(1);
    const storeSignals = {
        selectItemsFromSelectedCategory: selectedChannels,
        selectedItem,
        epgItems,
        selectedTypeContentLoading,
        selectedContentType,
        currentPlaylist,
        selectedCategoryId,
        setSelectedCategory: jest.fn(),
        toggleFavorite: jest.fn().mockResolvedValue(true),
    };
    const epgResults$ = new Subject<{ streamId: number; items: unknown[] }>();
    const favoritesService = {
        getFavorites: jest.fn().mockReturnValue(of([] as FavoriteItem[])),
    };

    beforeEach(async () => {
        storeSignals.setSelectedCategory.mockClear();
        storeSignals.toggleFavorite.mockClear();
        selectedChannels.set([]);
        selectedItem.set(null);
        epgItems.set([]);
        selectedTypeContentLoading.set(true);
        selectedContentType.set('live');
        currentPlaylist.set(null);
        selectedCategoryId.set(1);
        favoritesService.getFavorites.mockReturnValue(of([] as FavoriteItem[]));

        await TestBed.configureTestingModule({
            imports: [PortalChannelsListComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) =>
                            key === 'CHANNELS.LOADING'
                                ? 'Loading channels...'
                                : key,
                        get: (key: string) =>
                            of(
                                key === 'CHANNELS.LOADING'
                                    ? 'Loading channels...'
                                    : key
                            ),
                        stream: (key: string) =>
                            of(
                                key === 'CHANNELS.LOADING'
                                    ? 'Loading channels...'
                                    : key
                            ),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: storeSignals,
                },
                {
                    provide: FavoritesService,
                    useValue: favoritesService,
                },
                {
                    provide: EpgQueueService,
                    useValue: {
                        epgResult$: epgResults$,
                        getCached: jest.fn().mockReturnValue(null),
                        enqueue: jest.fn(),
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                    },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            params: {},
                        },
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(PortalChannelsListComponent);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('renders a loading placeholder instead of the empty state while xtream live content is still loading', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.channels-loading-state')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-search-state')
        ).toBeNull();
    });

    it('renders the empty state once loading has finished and the selected category has no channels', () => {
        selectedTypeContentLoading.set(false);

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.channels-loading-state')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-search-state')
        ).not.toBeNull();
    });

    it('selects the current preview program by timestamps, preserves them, and updates progress from them', () => {
        jest.useFakeTimers();
        const currentStartTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );
        const currentStopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:00:00.000Z') / 1000
        );
        const previousStartTimestamp = Math.floor(
            Date.parse('2026-04-05T05:00:00.000Z') / 1000
        );
        const previousStopTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );

        jest.setSystemTime(new Date('2026-04-05T05:45:00.000Z'));

        selectedTypeContentLoading.set(false);
        selectedChannels.set([
            {
                title: 'Cartoon Network',
                xtream_id: 50,
            },
        ]);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();

        epgResults$.next({
            streamId: 50,
            items: [
                buildEpgItem({
                    id: 'previous',
                    title: 'Previous Show',
                    start: '2026-04-05T03:00:00.000Z',
                    stop: '2026-04-05T03:30:00.000Z',
                    startTimestamp: previousStartTimestamp,
                    stopTimestamp: previousStopTimestamp,
                }),
                buildEpgItem({
                    id: 'current',
                    title: 'Current Show',
                    start: '2026-04-05T03:00:00.000Z',
                    stop: '2026-04-05T03:30:00.000Z',
                    startTimestamp: currentStartTimestamp,
                    stopTimestamp: currentStopTimestamp,
                }),
            ],
        });

        fixture.detectChanges();

        const component = fixture.componentInstance;
        expect(component.epgPrograms.get(50)).toEqual(
            expect.objectContaining({
                title: 'Current Show',
                startTimestamp: currentStartTimestamp,
                stopTimestamp: currentStopTimestamp,
            })
        );
        expect(component.currentProgramsProgress.get(50)).toBeCloseTo(50, 1);
    });

    it('does not mark a live item as favorite when only a colliding movie ID is favorited', () => {
        favoritesService.getFavorites.mockReturnValue(
            of([
                {
                    content_id: 42,
                    playlist_id: 'playlist-1',
                    type: 'movie',
                    title: 'Krypton',
                    category_id: 7,
                    xtream_id: 290,
                },
            ] satisfies FavoriteItem[])
        );
        selectedTypeContentLoading.set(false);
        selectedChannels.set([
            {
                title: 'SE: V Film Premiere FHD',
                type: 'live',
                xtream_id: 290,
            },
        ]);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();

        const component = fixture.componentInstance;
        expect(component.favorites.get('movie:290')).toBe(true);
        expect(component.favorites.get('live:290')).toBeUndefined();
        expect(
            component.favoriteKeyFor({
                title: 'SE: V Film Premiere FHD',
                type: 'live',
                xtream_id: 290,
            })
        ).toBe('live:290');
    });

    it('passes the live content type when toggling a channel favorite', async () => {
        selectedTypeContentLoading.set(false);
        currentPlaylist.set({
            id: 'playlist-1',
            password: 'secret',
            serverUrl: 'http://demo.example',
            username: 'demo',
        });

        fixture.detectChanges();

        fixture.componentInstance.toggleFavorite(
            new MouseEvent('click'),
            {
                title: 'Cartoon Network',
                xtream_id: 253,
            }
        );
        await Promise.resolve();

        expect(storeSignals.toggleFavorite).toHaveBeenCalledWith(
            253,
            'playlist-1',
            'live'
        );
        expect(fixture.componentInstance.favorites.get('live:253')).toBe(true);
    });
});
