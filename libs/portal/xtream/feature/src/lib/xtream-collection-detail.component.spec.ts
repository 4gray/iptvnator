import { signal } from '@angular/core';
import {
    ComponentFixture,
    TestBed,
    fakeAsync,
    flushMicrotasks,
} from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { VIEW_IN_PORTAL_HANDOFF } from '@iptvnator/ui/components';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { Subject, firstValueFrom, of } from 'rxjs';
import { SerialDetailsComponent } from './serial-details/serial-details.component';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details/serial-details-resume-target.token';
import { XtreamCollectionDetailComponent } from './xtream-collection-detail.component';

describe('XtreamCollectionDetailComponent', () => {
    let fixture: ComponentFixture<XtreamCollectionDetailComponent>;
    let playlistId: ReturnType<typeof signal<string>>;
    let currentPlaylist: ReturnType<typeof signal<XtreamPlaylistData | null>>;
    let selectedContentType: ReturnType<
        typeof signal<'live' | 'vod' | 'series'>
    >;
    let selectedCategoryId: ReturnType<typeof signal<number | null>>;
    let selectedItem: ReturnType<typeof signal<unknown>>;
    let isLoadingDetails: ReturnType<typeof signal<boolean>>;
    let detailsError: ReturnType<typeof signal<string | null>>;
    let cancelDetailsRequest: jest.Mock;
    let routerNavigate: jest.Mock;

    const seriesItem: UnifiedCollectionItem = {
        uid: 'xtream::xtream-1::series:103',
        name: 'Series One',
        contentType: 'series',
        sourceType: 'xtream',
        playlistId: 'xtream-1',
        playlistName: 'Xtream Portal',
        xtreamId: 103,
        categoryId: 3,
    };
    const detailPlaylist = {
        _id: 'xtream-1',
        title: 'Xtream Portal',
        serverUrl: 'http://xtream.example',
        username: 'user',
        password: 'pass',
    } as Playlist;

    beforeEach(async () => {
        playlistId = signal('original-playlist');
        currentPlaylist = signal<XtreamPlaylistData | null>({
            id: 'original-playlist',
            name: 'Original Portal',
            type: 'xtream',
            serverUrl: 'http://original.example',
            username: 'original-user',
            password: 'original-pass',
        });
        selectedContentType = signal<'live' | 'vod' | 'series'>('vod');
        selectedCategoryId = signal<number | null>(null);
        selectedItem = signal<unknown>(null);
        isLoadingDetails = signal(false);
        detailsError = signal<string | null>(null);
        cancelDetailsRequest = jest.fn();
        routerNavigate = jest.fn().mockResolvedValue(true);

        await TestBed.configureTestingModule({
            imports: [XtreamCollectionDetailComponent],
            providers: [
                {
                    provide: XtreamStore,
                    useValue: {
                        playlistId,
                        currentPlaylist,
                        selectedContentType,
                        selectedCategoryId,
                        selectedItem,
                        isLoadingDetails,
                        detailsError,
                        cancelDetailsRequest,
                        setPlaylistId: jest.fn((value: string) =>
                            playlistId.set(value)
                        ),
                        setCurrentPlaylist: jest.fn(
                            (value: XtreamPlaylistData | null) =>
                                currentPlaylist.set(value)
                        ),
                        setSelectedContentType: jest.fn(
                            (value: 'live' | 'vod' | 'series') =>
                                selectedContentType.set(value)
                        ),
                        setSelectedCategory: jest.fn((value: number | null) =>
                            selectedCategoryId.set(value)
                        ),
                        setSelectedItem: jest.fn((value: unknown) =>
                            selectedItem.set(value)
                        ),
                        setIsLoadingDetails: jest.fn((value: boolean) =>
                            isLoadingDetails.set(value)
                        ),
                        setDetailsError: jest.fn((value: string | null) =>
                            detailsError.set(value)
                        ),
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        navigate: routerNavigate,
                        url: '/workspace/global-recent',
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: jest.fn(() => of(detailPlaylist)),
                    },
                },
            ],
        })
            .overrideComponent(XtreamCollectionDetailComponent, {
                set: {
                    template: '',
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(XtreamCollectionDetailComponent);
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('opens Xtream series favorites with the serial detail route context', async () => {
        const seriesResume = {
            seriesXtreamId: 103,
            contentXtreamId: 2001,
            seasonNumber: 2,
            episodeNumber: 1,
        };
        fixture.componentRef.setInput('item', seriesItem);
        fixture.componentRef.setInput('seriesResume', seriesResume);

        fixture.detectChanges();
        await fixture.whenStable();
        await Promise.resolve();
        fixture.detectChanges();

        expect(selectedContentType()).toBe('series');
        expect(selectedCategoryId()).toBe(3);
        expect(fixture.componentInstance.detailComponent()).toBe(
            SerialDetailsComponent
        );
        const route = fixture.componentInstance
            .detailInjector()
            ?.get(ActivatedRoute);
        expect(route?.snapshot.params).toEqual({
            categoryId: '3',
            serialId: '103',
        });
        // Regression: the detail components consume route.params via
        // toSignal(), so the fake route must expose the observable too —
        // otherwise the inline detail crashes on construction.
        expect(route?.params).toBeDefined();
        if (!route) {
            throw new Error('expected an inline ActivatedRoute');
        }
        await expect(firstValueFrom(route.params)).resolves.toEqual({
            categoryId: '3',
            serialId: '103',
        });
        expect(
            fixture.componentInstance
                .detailInjector()
                ?.get(XTREAM_SERIES_RESUME_TARGET)()
        ).toEqual(seriesResume);
    });

    it('ignores a playlist that resolves after the collection detail is destroyed', fakeAsync(() => {
        const pendingPlaylist = new Subject<Playlist>();
        const loadPlaylist = jest
            .spyOn(TestBed.inject(PlaylistsService), 'getPlaylistById')
            .mockReturnValueOnce(pendingPlaylist);
        const store = TestBed.inject(XtreamStore);
        const originalPlaylist = currentPlaylist();
        const component = fixture.componentInstance;
        fixture.componentRef.setInput('item', seriesItem);
        fixture.detectChanges();
        expect(loadPlaylist).toHaveBeenCalledWith(seriesItem.playlistId);

        fixture.destroy();
        expect(cancelDetailsRequest).toHaveBeenCalledTimes(1);
        expect(playlistId()).toBe('original-playlist');
        expect(currentPlaylist()).toBe(originalPlaylist);
        jest.clearAllMocks();

        pendingPlaylist.next(detailPlaylist);
        flushMicrotasks();

        expect(playlistId()).toBe('original-playlist');
        expect(currentPlaylist()).toBe(originalPlaylist);
        for (const setter of [
            store.setPlaylistId,
            store.setCurrentPlaylist,
            store.setSelectedContentType,
            store.setSelectedCategory,
            store.setSelectedItem,
            store.setIsLoadingDetails,
            store.setDetailsError,
        ]) {
            expect(setter).not.toHaveBeenCalled();
        }
        expect(component.detailComponent()).toBeNull();
        expect(component.detailInjector()).toBeNull();
    }));

    it('keeps the newer selection when an earlier playlist resolves last', fakeAsync(() => {
        const pendingPlaylist = new Subject<Playlist>();
        jest.spyOn(TestBed.inject(PlaylistsService), 'getPlaylistById')
            .mockReturnValueOnce(pendingPlaylist)
            .mockReturnValueOnce(of({ ...detailPlaylist, _id: 'xtream-2' }));
        fixture.componentRef.setInput('item', seriesItem);
        fixture.detectChanges();
        fixture.componentRef.setInput('item', {
            ...seriesItem,
            uid: 'xtream::xtream-2::series:203',
            playlistId: 'xtream-2',
            xtreamId: 203,
            categoryId: 6,
        } satisfies UnifiedCollectionItem);
        fixture.detectChanges();
        flushMicrotasks();
        const detailInjector = fixture.componentInstance.detailInjector();

        pendingPlaylist.next(detailPlaylist);
        flushMicrotasks();

        expect(playlistId()).toBe('xtream-2');
        expect(currentPlaylist()?.id).toBe('xtream-2');
        expect(selectedCategoryId()).toBe(6);
        expect(fixture.componentInstance.detailInjector()).toBe(detailInjector);
        expect(detailInjector?.get(ActivatedRoute).snapshot.params).toEqual({
            categoryId: '6',
            serialId: '203',
        });
    }));

    it('invalidates detail loading before restoring the underlying store', () => {
        fixture.componentInstance.ngOnDestroy();

        expect(cancelDetailsRequest).toHaveBeenCalledTimes(1);
    });

    it('ignores a pending playlist load after the collection detail is destroyed', fakeAsync(() => {
        const pendingPlaylist = new Subject<Playlist>();
        jest.spyOn(
            TestBed.inject(PlaylistsService),
            'getPlaylistById'
        ).mockReturnValue(pendingPlaylist);
        fixture.componentRef.setInput('item', {
            uid: 'xtream::xtream-1::movie:99',
            name: 'Movie One',
            contentType: 'movie',
            sourceType: 'xtream',
            playlistId: 'xtream-1',
            playlistName: 'Xtream Portal',
            xtreamId: 99,
            categoryId: 42,
        } satisfies UnifiedCollectionItem);
        fixture.detectChanges();

        fixture.destroy();
        const nextPlaylist: XtreamPlaylistData = {
            id: 'xtream-2',
            name: 'Next Portal',
            serverUrl: 'http://next.example',
            username: 'next-user',
            password: 'next-pass',
            type: 'xtream',
        };
        playlistId.set(nextPlaylist.id);
        currentPlaylist.set(nextPlaylist);
        selectedContentType.set('live');

        pendingPlaylist.next({
            _id: 'xtream-1',
            title: 'Xtream Portal',
            serverUrl: 'http://xtream.example',
            username: 'user',
            password: 'pass',
        } as Playlist);
        flushMicrotasks();

        expect(playlistId()).toBe('xtream-2');
        expect(currentPlaylist()).toBe(nextPlaylist);
        expect(selectedContentType()).toBe('live');
        expect(fixture.componentInstance.detailComponent()).toBeNull();
        expect(fixture.componentInstance.detailInjector()).toBeNull();
    }));

    it('provides itself as the view-in-portal handoff to the inline detail', async () => {
        fixture.componentRef.setInput('item', {
            uid: 'xtream::xtream-1::movie:99',
            name: 'Movie One',
            contentType: 'movie',
            sourceType: 'xtream',
            playlistId: 'xtream-1',
            playlistName: 'Xtream Portal',
            xtreamId: 99,
            categoryId: 42,
        } satisfies UnifiedCollectionItem);

        fixture.detectChanges();
        await fixture.whenStable();
        await Promise.resolve();
        fixture.detectChanges();

        expect(
            fixture.componentInstance
                .detailInjector()
                ?.get(VIEW_IN_PORTAL_HANDOFF)
        ).toBe(fixture.componentInstance);
        expect(fixture.componentInstance.viewInPortalAvailable()).toBe(true);
        expect(fixture.componentInstance.viewInPortalPlaylistName()).toBe(
            'Xtream Portal'
        );

        fixture.componentInstance.openInPortal();
        expect(routerNavigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'xtream-1', 'vod', '42', '99'],
            { state: undefined }
        );
    });

    it('reports the handoff unavailable when the item lacks a category', () => {
        fixture.componentRef.setInput('item', {
            uid: 'xtream::xtream-1::movie:99',
            name: 'Movie One',
            contentType: 'movie',
            sourceType: 'xtream',
            playlistId: 'xtream-1',
            playlistName: 'Xtream Portal',
            xtreamId: 99,
        } satisfies UnifiedCollectionItem);
        fixture.detectChanges();

        expect(fixture.componentInstance.viewInPortalAvailable()).toBe(false);

        fixture.componentInstance.openInPortal();
        expect(routerNavigate).not.toHaveBeenCalled();
    });
});
