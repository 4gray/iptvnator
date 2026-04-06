import { Directive, Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MockPipe } from 'ng-mocks';
import { TranslatePipe } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PORTAL_PLAYER, ResizableDirective } from '@iptvnator/portal/shared/util';
import {
    FavoritesService,
    XtreamStore,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { EpgListComponent, EpgProgramActivationEvent } from '@iptvnator/ui/epg';
import { EpgViewComponent, WebPlayerViewComponent } from 'shared-portals';
import { EpgItem, EpgProgram } from 'shared-interfaces';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';

@Component({
    selector: 'app-portal-channels-list',
    standalone: true,
    template: '',
})
class StubPortalChannelsListComponent {
    readonly sortMode = input<'server' | 'name-asc' | 'name-desc'>('server');
    readonly searchTermInput = input('');
    readonly playClicked = output<unknown>();
}

@Component({
    selector: 'app-web-player-view',
    standalone: true,
    template: '',
})
class StubWebPlayerViewComponent {
    readonly streamUrl = input('');
}

@Component({
    selector: 'app-epg-view',
    standalone: true,
    template: '',
})
class StubEpgViewComponent {
    readonly epgItems = input<EpgItem[]>([]);
}

@Component({
    selector: 'app-epg-list',
    standalone: true,
    template: '',
})
class StubEpgListComponent {
    readonly controlledPrograms = input<EpgProgram[] | null>(null);
    readonly controlledArchiveDays = input<number | null>(null);
    readonly programActivated = output<EpgProgramActivationEvent>();
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
class StubResizableDirective {}

describe('LiveStreamLayoutComponent', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    const fixedNow = new Date('2026-04-05T12:00:00.000Z');

    const sampleChannel = {
        xtream_id: 101,
        name: 'Channel 101',
        stream_icon: 'channel-101.png',
        tv_archive: 1,
        tv_archive_duration: 3,
    };
    const playlist = {
        id: 'playlist-1',
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };

    const categories = signal([{ category_id: 1, category_name: 'News' }]);
    const categoryItemCounts = signal(new Map<number, number>([[1, 1]]));
    const epgItems = signal<EpgItem[]>([]);
    const currentEpgItem = signal<EpgItem | null>(null);
    const isLoadingEpg = signal(false);
    const selectedCategoryId = signal<number | null>(1);
    const selectedContentType = signal<'live' | 'vod' | 'series'>('live');
    const selectedItem = signal<unknown>(sampleChannel);
    const currentPlaylist = signal(playlist);

    const xtreamStore = {
        getCategoriesBySelectedType: categories,
        getCategoryItemCounts: categoryItemCounts,
        epgItems,
        currentEpgItem,
        isLoadingEpg,
        selectedCategoryId,
        selectedContentType,
        selectedItem,
        currentPlaylist,
        selectItemsFromSelectedCategory: jest.fn(() => [sampleChannel]),
        constructStreamUrl: jest.fn(() => 'https://example.com/live.ts'),
        openPlayer: jest.fn(),
    };
    const favoritesService = {
        getFavorites: jest.fn().mockReturnValue(of([])),
    };
    const xtreamUrlService = {
        resolveCatchupUrl: jest.fn().mockResolvedValue(
            'https://example.com/timeshift.ts'
        ),
    };
    const portalPlayer = {
        isEmbeddedPlayer: jest.fn().mockReturnValue(true),
    };

    const originalElectron = window.electron;

    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(fixedNow);

        window.electron = {
            updateRemoteControlStatus: jest.fn(),
        } as typeof window.electron;

        xtreamStore.constructStreamUrl.mockClear();
        xtreamStore.openPlayer.mockClear();
        xtreamStore.selectItemsFromSelectedCategory.mockReturnValue([
            sampleChannel,
        ]);
        favoritesService.getFavorites.mockClear();
        xtreamUrlService.resolveCatchupUrl.mockClear();
        portalPlayer.isEmbeddedPlayer.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);

        epgItems.set([]);
        currentEpgItem.set(null);
        isLoadingEpg.set(false);
        selectedCategoryId.set(1);
        selectedContentType.set('live');
        selectedItem.set(sampleChannel);
        currentPlaylist.set(playlist);

        await TestBed.configureTestingModule({
            imports: [LiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({}),
                        },
                        queryParamMap: of(convertToParamMap({})),
                        pathFromRoot: [
                            {
                                snapshot: {
                                    data: {},
                                },
                            },
                        ],
                    },
                },
                { provide: XtreamStore, useValue: xtreamStore },
                { provide: FavoritesService, useValue: favoritesService },
                { provide: XtreamUrlService, useValue: xtreamUrlService },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
            ],
        })
            .overrideComponent(LiveStreamLayoutComponent, {
                remove: {
                    imports: [
                        EpgListComponent,
                        EpgViewComponent,
                        PortalChannelsListComponent,
                        ResizableDirective,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubEpgListComponent,
                        StubEpgViewComponent,
                        StubPortalChannelsListComponent,
                        StubResizableDirective,
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
    });

    afterEach(() => {
        fixture.destroy();
        jest.useRealTimers();
        window.electron = originalElectron;
    });

    it('renders the controlled epg list for electron playback', () => {
        epgItems.set([
            buildEpgItem(
                '1',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);

        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-view')
        ).toBeNull();
    });

    it('uses currentEpgItem instead of assuming the first schedule item is current', () => {
        epgItems.set([
            buildEpgItem(
                'past',
                'Past Show',
                '2026-04-05T08:00:00.000Z',
                '2026-04-05T09:00:00.000Z'
            ),
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);
        currentEpgItem.set(epgItems()[1]);

        fixture.detectChanges();

        expect(window.electron?.updateRemoteControlStatus).toHaveBeenCalledWith(
            expect.objectContaining({
                epgTitle: 'Current Show',
            })
        );
    });

    it('resolves a catchup url for archived program activation', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        await component.onProgramActivated({
            type: 'timeshift',
            program: {
                start: '2026-04-04T10:00:00.000Z',
                stop: '2026-04-04T11:00:00.000Z',
                channel: 'channel-101',
                title: 'Archived Show',
                desc: null,
                category: null,
                startTimestamp: 1775296800,
                stopTimestamp: 1775300400,
            },
        });

        expect(xtreamUrlService.resolveCatchupUrl).toHaveBeenCalledWith(
            'playlist-1',
            {
                serverUrl: 'http://demo.example',
                username: 'demo',
                password: 'secret',
            },
            101,
            1775296800,
            1775300400
        );
        expect(xtreamStore.openPlayer).toHaveBeenCalledWith(
            'https://example.com/timeshift.ts',
            'Channel 101 - Archived Show',
            'channel-101.png'
        );
    });

    it('shows an archive-unavailable notice when past programs exist but archive playback is unavailable', () => {
        const nonArchiveChannel = {
            ...sampleChannel,
            tv_archive: 0,
            tv_archive_duration: null,
        };
        selectedItem.set(nonArchiveChannel);
        epgItems.set([
            buildEpgItem(
                'past',
                'Past Show',
                '2026-04-05T09:00:00.000Z',
                '2026-04-05T10:00:00.000Z'
            ),
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);

        component.playLive(nonArchiveChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.archive-unavailable-banner')
        ).not.toBeNull();
    });

    it('hides the archive-unavailable notice when archive playback is available', () => {
        selectedItem.set(sampleChannel);
        epgItems.set([
            buildEpgItem(
                'past',
                'Past Show',
                '2026-04-05T09:00:00.000Z',
                '2026-04-05T10:00:00.000Z'
            ),
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ]);

        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.archive-unavailable-banner')
        ).toBeNull();
    });

    it('hides the archive-unavailable notice when there are no past programs yet', () => {
        const nonArchiveChannel = {
            ...sampleChannel,
            tv_archive: 0,
            tv_archive_duration: null,
        };
        selectedItem.set(nonArchiveChannel);
        epgItems.set([
            buildEpgItem(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
            buildEpgItem(
                'future',
                'Future Show',
                '2026-04-05T12:30:00.000Z',
                '2026-04-05T13:30:00.000Z'
            ),
        ]);

        component.playLive(nonArchiveChannel);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.archive-unavailable-banner')
        ).toBeNull();
    });
});

function buildEpgItem(
    id: string,
    title: string,
    start: string,
    stop: string
): EpgItem {
    return {
        id,
        epg_id: `epg-${id}`,
        title,
        description: '',
        lang: 'en',
        start,
        stop,
        end: stop,
        channel_id: 'channel-101',
        start_timestamp: String(Math.floor(Date.parse(start) / 1000)),
        stop_timestamp: String(Math.floor(Date.parse(stop) / 1000)),
    };
}
