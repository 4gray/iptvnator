import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { convertToParamMap, ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of, Subject } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { ChannelActions, PlaylistActions } from 'm3u-state';
import { PlaylistsService } from 'services';
import { PlaylistMeta } from 'shared-interfaces';
import { ChannelListContainerComponent } from './channel-list-container.component';

describe('ChannelListContainerComponent', () => {
    let fixture: ComponentFixture<ChannelListContainerComponent>;
    let dispatch: jest.Mock;
    let activePlaylistSignal: ReturnType<typeof signal<PlaylistMeta | null>>;

    beforeEach(async () => {
        const routerEvents$ = new Subject<NavigationEnd>();
        dispatch = jest.fn();
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
                    provide: StorageMap,
                    useValue: {
                        get: jest.fn().mockReturnValue(of({})),
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        dispatch,
                        select: jest.fn().mockReturnValue(of([])),
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
});
