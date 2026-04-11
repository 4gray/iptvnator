import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { convertToParamMap, ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of, Subject } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { ChannelActions } from 'm3u-state';
import { PlaylistsService } from 'services';
import { ChannelListContainerComponent } from './channel-list-container.component';

describe('ChannelListContainerComponent', () => {
    let fixture: ComponentFixture<ChannelListContainerComponent>;
    let dispatch: jest.Mock;

    beforeEach(async () => {
        const routerEvents$ = new Subject<NavigationEnd>();
        dispatch = jest.fn();

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
});
