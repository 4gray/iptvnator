import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MockPipe } from 'ng-mocks';
import { TranslatePipe } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { Subject, of } from 'rxjs';
import {
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    FavoritesService,
    XtreamStore,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    EpgArchiveCopyService,
    EpgArchiveDownloadService,
    EpgListViewComponent,
    EpgTimelineComponent,
} from '@iptvnator/ui/epg';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { GridListComponent } from '@iptvnator/portal/shared/ui';
import {
    DatabaseService,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import {
    playlist,
    sampleChannel,
    StubEpgTimelineComponent,
    StubGridListComponent,
    StubPortalChannelsListComponent,
    StubWebPlayerViewComponent,
} from './live-stream-layout-stubs.spec-data';

const HOUR = 3600;
const T0 = Date.parse('2026-04-04T10:00:00.000Z') / 1000;

function epgItem(title: string, fromHour: number, toHour: number): EpgItem {
    const start = new Date((T0 + fromHour * HOUR) * 1000).toISOString();
    const stop = new Date((T0 + toHour * HOUR) * 1000).toISOString();
    return {
        id: title,
        epg_id: `epg-${title}`,
        title,
        description: '',
        lang: 'en',
        start,
        stop,
        end: stop,
        channel_id: 'channel-101',
        start_timestamp: String(T0 + fromHour * HOUR),
        stop_timestamp: String(T0 + toHour * HOUR),
    };
}

/**
 * Catch-up programmes on the player's seek bar. Split from
 * `live-stream-layout.component.spec.ts`, which sits at the spec line cap.
 */
describe('LiveStreamLayoutComponent catch-up timeline segments', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    const emptyList = signal<unknown[]>([]);
    const epgItems = signal<EpgItem[]>([]);
    const parentalLock = {
        version: signal(0),
        active: signal(false),
        isXtreamCategoryLocked: jest.fn(() => false),
    };
    const databaseService = {
        getAllXtreamCategories: jest.fn(async () => [] as unknown[]),
    };
    const runtime = { supportsXtreamSqliteDataSource: false };
    const xtreamStore = {
        getCategoriesBySelectedType: signal([
            { category_id: 1, category_name: 'News' },
        ]),
        liveCategories: signal([{ id: 1, xtream_id: 1, name: 'News' }]),
        getCategoryItemCounts: signal(new Map<number, number>([[1, 1]])),
        getPaginatedContent: emptyList,
        hasMoreContent: signal(false),
        epgItems,
        currentEpgItem: signal(null),
        isLoadingEpg: signal(false),
        selectedTypeContentLoading: signal(false),
        selectedCategoryId: signal<number | null>(1),
        selectedContentType: signal('live'),
        selectedItem: signal<unknown>(sampleChannel),
        currentPlaylist: signal(playlist),
        liveStreams: emptyList,
        isContentInitialized: signal(true),
        selectItemsFromSelectedCategory: jest.fn(() => []),
        constructStreamUrl: jest.fn(() => 'https://example.com/live.ts'),
        openPlayer: jest.fn(),
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
        loadMoreContent: jest.fn(),
    };

    beforeEach(async () => {
        epgItems.set([]);

        await TestBed.configureTestingModule({
            imports: [LiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: EpgArchiveDownloadService,
                    useValue: { start: jest.fn() },
                },
                {
                    provide: EpgArchiveCopyService,
                    useValue: { copy: jest.fn() },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({}),
                        },
                        queryParamMap: of(convertToParamMap({})),
                        pathFromRoot: [
                            { snapshot: { data: { layout: 'workspace' } } },
                        ],
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        events: new Subject().asObservable(),
                        navigate: jest.fn(),
                    },
                },
                { provide: XtreamStore, useValue: xtreamStore },
                {
                    provide: FavoritesService,
                    useValue: { getFavorites: jest.fn(() => of([])) },
                },
                {
                    provide: XtreamUrlService,
                    useValue: {
                        constructAutoLiveTsUrl: jest.fn(() => undefined),
                        resolveCatchupUrl: jest.fn(
                            async () => 'https://example.com/timeshift.ts'
                        ),
                    },
                },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                { provide: DatabaseService, useValue: databaseService },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openExternalPlayback: jest.fn(),
                    },
                },
                { provide: ParentalLockService, useValue: parentalLock },
            ],
        })
            .overrideComponent(LiveStreamLayoutComponent, {
                remove: {
                    imports: [
                        EpgListViewComponent,
                        EpgTimelineComponent,
                        GridListComponent,
                        PortalChannelsListComponent,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubEpgTimelineComponent,
                        StubGridListComponent,
                        StubPortalChannelsListComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                        StubWebPlayerViewComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        TestBed.inject(LiveLayoutSidebarStateService).setState(
            'portal',
            'expanded'
        );
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    const webPlayer = () =>
        fixture.debugElement.query(By.directive(StubWebPlayerViewComponent))
            .componentInstance as StubWebPlayerViewComponent;

    it('draws the archive window programmes until live playback resumes', async () => {
        epgItems.set([
            epgItem('Morning News', -1, 0),
            epgItem('Archived Show', 0, 1),
            epgItem('Afternoon Film', 1, 3),
        ]);
        component.playLive(sampleChannel);
        fixture.detectChanges();
        expect(webPlayer().timelineSegments()).toBeNull();

        const archived: EpgProgram = {
            ...component.controlledEpgPrograms()[1],
        };
        await component.onProgramActivated({
            type: 'timeshift',
            program: archived,
        });
        fixture.detectChanges();

        // Xtream's timeshift URL requests exactly the programme.
        expect(webPlayer().timelineSegments()).toEqual([
            { startSeconds: 0, endSeconds: HOUR, title: 'Archived Show' },
        ]);

        component.playLive(sampleChannel);
        fixture.detectChanges();
        expect(webPlayer().timelineSegments()).toBeNull();
    });
});
