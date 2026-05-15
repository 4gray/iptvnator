import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { SerialDetailsComponent } from './serial-details/serial-details.component';
import { XtreamCollectionDetailComponent } from './xtream-collection-detail.component';

describe('XtreamCollectionDetailComponent', () => {
    let fixture: ComponentFixture<XtreamCollectionDetailComponent>;
    let playlistId: ReturnType<typeof signal<string>>;
    let currentPlaylist: ReturnType<
        typeof signal<XtreamPlaylistData | null>
    >;
    let selectedContentType: ReturnType<
        typeof signal<'live' | 'vod' | 'series'>
    >;
    let selectedCategoryId: ReturnType<typeof signal<number | null>>;
    let selectedItem: ReturnType<typeof signal<unknown>>;
    let isLoadingDetails: ReturnType<typeof signal<boolean>>;
    let detailsError: ReturnType<typeof signal<string | null>>;

    beforeEach(async () => {
        playlistId = signal('');
        currentPlaylist = signal<XtreamPlaylistData | null>(null);
        selectedContentType = signal<'live' | 'vod' | 'series'>('vod');
        selectedCategoryId = signal<number | null>(null);
        selectedItem = signal<unknown>(null);
        isLoadingDetails = signal(false);
        detailsError = signal<string | null>(null);

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
                        setSelectedCategory: jest.fn(
                            (value: number | null) =>
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
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: jest.fn(() =>
                            of({
                                _id: 'xtream-1',
                                title: 'Xtream Portal',
                                serverUrl: 'http://xtream.example',
                                username: 'user',
                                password: 'pass',
                            } as Playlist)
                        ),
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
        fixture.componentRef.setInput(
            'item',
            {
                uid: 'xtream::xtream-1::series:103',
                name: 'Series One',
                contentType: 'series',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream Portal',
                xtreamId: 103,
                categoryId: 3,
            } satisfies UnifiedCollectionItem
        );

        fixture.detectChanges();
        await fixture.whenStable();
        await Promise.resolve();
        fixture.detectChanges();

        expect(selectedContentType()).toBe('series');
        expect(selectedCategoryId()).toBe(3);
        expect(fixture.componentInstance.detailComponent()).toBe(
            SerialDetailsComponent
        );
        expect(
            fixture.componentInstance
                .detailInjector()
                ?.get(ActivatedRoute)
                .snapshot.params
        ).toEqual({
            categoryId: '3',
            serialId: '103',
        });
    });
});
