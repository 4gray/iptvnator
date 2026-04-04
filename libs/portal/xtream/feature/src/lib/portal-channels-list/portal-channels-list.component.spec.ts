import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import {
    EpgQueueService,
    FavoritesService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PortalChannelsListComponent } from './portal-channels-list.component';

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
    };
    const epgResults$ = new Subject<{ streamId: number; items: unknown[] }>();

    beforeEach(async () => {
        storeSignals.setSelectedCategory.mockClear();
        selectedChannels.set([]);
        selectedItem.set(null);
        epgItems.set([]);
        selectedTypeContentLoading.set(true);
        selectedContentType.set('live');
        currentPlaylist.set(null);
        selectedCategoryId.set(1);

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
                    useValue: {
                        getFavorites: jest.fn().mockReturnValue(of([])),
                    },
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
});
