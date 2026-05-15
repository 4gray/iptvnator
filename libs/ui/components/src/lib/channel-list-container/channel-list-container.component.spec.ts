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
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
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
    let favoriteChannelIds$: BehaviorSubject<string[]>;

    beforeEach(async () => {
        const routerEvents$ = new Subject<NavigationEnd>();
        dispatch = jest.fn();
        favoriteChannelIds$ = new BehaviorSubject<string[]>([]);
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
                    useValue: {
                        getChannelMetadataForChannels: jest
                            .fn()
                            .mockReturnValue(of(new Map())),
                        getCurrentProgramsForChannels: jest
                            .fn()
                            .mockReturnValue(of(new Map())),
                    },
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
                        get: jest.fn().mockReturnValue(of({})),
                    },
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
