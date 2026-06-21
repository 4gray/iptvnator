import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    convertToParamMap,
    ActivatedRoute,
    NavigationEnd,
    Router,
} from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { BehaviorSubject, firstValueFrom, of, Subject } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { ChannelActions, PlaylistActions } from '@iptvnator/m3u-state';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { Channel, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { ChannelListContainerComponent } from './channel-list-container.component';

function createChannel(id: string, url: string): Channel {
    return {
        id,
        url,
        name: id,
        group: { title: 'Group' },
        tvg: {
            id,
            name: id,
            url: '',
            logo: '',
            rec: '',
        },
        http: {
            referrer: '',
            'user-agent': '',
            origin: '',
        },
        radio: 'false',
    };
}

function createTrackedUrlChannel(
    id: string,
    url: string,
    onUrlRead: () => void
): Channel {
    const channel = createChannel(id, url);

    Object.defineProperty(channel, 'url', {
        configurable: true,
        enumerable: true,
        get: () => {
            onUrlRead();
            return url;
        },
    });

    return channel;
}

describe('ChannelListContainerComponent', () => {
    let fixture: ComponentFixture<ChannelListContainerComponent>;
    let dispatch: jest.Mock;
    let activePlaylistSignal: ReturnType<typeof signal<PlaylistMeta | null>>;
    let epgService: {
        epgAvailable$: BehaviorSubject<boolean>;
        getChannelMetadataForChannels: jest.Mock;
        getCurrentProgramsForChannels: jest.Mock;
    };
    let favoriteChannelIds$: BehaviorSubject<string[]>;
    let runtimeCapabilities: { supportsEpg: boolean };
    let storageGet: jest.Mock;

    beforeEach(async () => {
        const routerEvents$ = new Subject<NavigationEnd>();
        dispatch = jest.fn();
        favoriteChannelIds$ = new BehaviorSubject<string[]>([]);
        runtimeCapabilities = { supportsEpg: true };
        storageGet = jest.fn().mockReturnValue(of({}));
        epgService = {
            epgAvailable$: new BehaviorSubject<boolean>(false),
            getChannelMetadataForChannels: jest
                .fn()
                .mockReturnValue(of(new Map())),
            getCurrentProgramsForChannels: jest
                .fn()
                .mockReturnValue(of(new Map())),
        };
        activePlaylistSignal = signal<PlaylistMeta | null>({
            _id: 'playlist-1',
            title: 'Playlist One',
            count: 0,
            importDate: '2026-04-11T00:00:00.000Z',
            hiddenGroupTitles: ['News'],
        } as PlaylistMeta);

        const route = {
            snapshot: {
                data: { layout: 'workspace' },
                paramMap: convertToParamMap({}),
                queryParamMap: convertToParamMap({}),
                params: {},
                queryParams: {},
            },
            pathFromRoot: [
                {
                    snapshot: {
                        data: { layout: 'workspace' },
                        paramMap: convertToParamMap({}),
                        params: {},
                    },
                    paramMap: of(convertToParamMap({})),
                },
            ],
            paramMap: of(convertToParamMap({})),
            queryParamMap: of(convertToParamMap({})),
        } as unknown as ActivatedRoute;

        await TestBed.configureTestingModule({
            imports: [ChannelListContainerComponent],
            providers: [
                {
                    provide: EpgService,
                    useValue: epgService,
                },
                {
                    provide: PlaylistsService,
                    useValue: {},
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                    },
                },
                {
                    provide: StorageMap,
                    useValue: {
                        get: storageGet,
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
                {
                    provide: Store,
                    useValue: {
                        dispatch,
                        select: jest
                            .fn()
                            .mockReturnValue(
                                favoriteChannelIds$.asObservable()
                            ),
                        selectSignal: jest.fn(() => signal(undefined)),
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        url: '/workspace/playlists/demo/all',
                        events: routerEvents$.asObservable(),
                    },
                },
                {
                    provide: ActivatedRoute,
                    useValue: route,
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        activePlaylist: activePlaylistSignal,
                        resolvedPlaylistId: signal(null),
                    },
                },
            ],
        })
            .overrideComponent(ChannelListContainerComponent, {
                set: {
                    template: '',
                    imports: [],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(ChannelListContainerComponent);
    });

    it('does not clear the shared channel list on destroy', () => {
        fixture.detectChanges();

        fixture.destroy();

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith(
            ChannelActions.resetActiveChannel()
        );
    });

    it('does not enable EPG rows when runtime EPG support is unavailable', () => {
        runtimeCapabilities.supportsEpg = false;
        storageGet.mockReturnValue(
            of({ epgUrl: ['https://example.com/epg.xml'] })
        );

        fixture.detectChanges();

        expect(fixture.componentInstance.shouldShowEpg()).toBe(false);
        expect(storageGet).not.toHaveBeenCalled();
    });

    it('enables EPG rows when runtime EPG support and an EPG URL are available', () => {
        runtimeCapabilities.supportsEpg = true;
        storageGet.mockReturnValue(
            of({ epgUrl: ['https://example.com/epg.xml'] })
        );

        fixture.detectChanges();

        expect(storageGet).toHaveBeenCalled();
        expect(fixture.componentInstance.shouldShowEpg()).toBe(true);
    });

    it('enables EPG rows and scopes lookups when the active M3U playlist has detected EPG URLs', () => {
        runtimeCapabilities.supportsEpg = true;
        storageGet.mockReturnValue(of({ epgUrl: [] }));
        activePlaylistSignal.set({
            _id: 'playlist-1',
            title: 'Playlist One',
            count: 1,
            importDate: '2026-04-11T00:00:00.000Z',
            epgUrls: ['https://playlist.example.com/guide.xml'],
        } as PlaylistMeta);

        fixture.detectChanges();
        fixture.componentInstance.channelList = [
            createChannel('guide-news', 'https://example.com/news.m3u8'),
        ];

        expect(fixture.componentInstance.shouldShowEpg()).toBe(true);
        expect(epgService.getCurrentProgramsForChannels).toHaveBeenCalledWith(
            ['guide-news'],
            { sourceUrls: ['https://playlist.example.com/guide.xml'] }
        );
        expect(epgService.getChannelMetadataForChannels).toHaveBeenCalledWith(
            ['guide-news'],
            { sourceUrls: ['https://playlist.example.com/guide.xml'] }
        );
    });

    it('refreshes visible channel EPG when playlist EPG URLs arrive after channels', () => {
        runtimeCapabilities.supportsEpg = true;
        storageGet.mockReturnValue(of({ epgUrl: [] }));

        fixture.detectChanges();
        fixture.componentInstance.channelList = [
            createChannel('guide-news', 'https://example.com/news.m3u8'),
        ];
        expect(epgService.getCurrentProgramsForChannels).toHaveBeenCalledWith(
            ['guide-news'],
            undefined
        );
        epgService.getCurrentProgramsForChannels.mockClear();
        epgService.getChannelMetadataForChannels.mockClear();

        activePlaylistSignal.set({
            _id: 'playlist-1',
            title: 'Playlist One',
            count: 1,
            importDate: '2026-04-11T00:00:00.000Z',
            epgUrls: ['https://playlist.example.com/guide.xml'],
        } as PlaylistMeta);
        fixture.detectChanges();

        expect(epgService.getCurrentProgramsForChannels).toHaveBeenCalledWith(
            ['guide-news'],
            { sourceUrls: ['https://playlist.example.com/guide.xml'] }
        );
        expect(epgService.getChannelMetadataForChannels).toHaveBeenCalledWith(
            ['guide-news'],
            { sourceUrls: ['https://playlist.example.com/guide.xml'] }
        );
    });

    it('debounces visible channel EPG row refreshes after EPG imports complete', () => {
        jest.useFakeTimers();
        try {
            runtimeCapabilities.supportsEpg = true;
            activePlaylistSignal.set({
                _id: 'playlist-1',
                title: 'Playlist One',
                count: 1,
                importDate: '2026-04-11T00:00:00.000Z',
                epgUrls: ['https://playlist.example.com/guide.xml'],
            } as PlaylistMeta);

            fixture.detectChanges();
            fixture.componentInstance.channelList = [
                createChannel('guide-news', 'https://example.com/news.m3u8'),
            ];
            epgService.getCurrentProgramsForChannels.mockClear();

            epgService.epgAvailable$.next(true);
            epgService.epgAvailable$.next(true);
            jest.advanceTimersByTime(1999);

            expect(
                epgService.getCurrentProgramsForChannels
            ).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1);

            expect(
                epgService.getCurrentProgramsForChannels
            ).toHaveBeenCalledTimes(1);
            expect(
                epgService.getCurrentProgramsForChannels
            ).toHaveBeenCalledWith(['guide-news'], {
                sourceUrls: ['https://playlist.example.com/guide.xml'],
            });
        } finally {
            fixture.destroy();
            jest.useRealTimers();
        }
    });

    it('dispatches playlist meta updates when hidden group titles change', () => {
        fixture.componentInstance.onHiddenGroupTitlesChanged([
            'Movies',
            'Sports',
        ]);

        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: 'playlist-1',
                    hiddenGroupTitles: ['Movies', 'Sports'],
                } as PlaylistMeta,
            })
        );
    });

    it('maps favorite URLs with one channel lookup pass while preserving order and first duplicate match', async () => {
        let urlReadCount = 0;
        const firstDuplicate = createTrackedUrlChannel(
            'first-duplicate',
            'duplicate-url',
            () => {
                urlReadCount += 1;
            }
        );
        const sports = createTrackedUrlChannel('sports', 'sports-url', () => {
            urlReadCount += 1;
        });
        const secondDuplicate = createTrackedUrlChannel(
            'second-duplicate',
            'duplicate-url',
            () => {
                urlReadCount += 1;
            }
        );

        fixture.componentInstance.channelList = [
            firstDuplicate,
            sports,
            secondDuplicate,
        ];
        favoriteChannelIds$.next([
            'sports-url',
            'missing-url',
            'duplicate-url',
        ]);
        urlReadCount = 0;

        const favorites = await firstValueFrom(
            fixture.componentInstance.favorites$
        );

        expect(favorites).toHaveLength(2);
        expect(favorites[0]).toBe(sports);
        expect(favorites[1]).toBe(firstDuplicate);
        expect(urlReadCount).toBe(3);
    });
});
