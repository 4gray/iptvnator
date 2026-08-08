import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { EpgItemDescriptionComponent } from '@iptvnator/ui/epg';
import { ElectronStreamHeadersService } from '@iptvnator/ui/playback';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';

describe('StalkerLiveStreamLayoutComponent row context menu', () => {
    let fixture: ComponentFixture<StalkerLiveStreamLayoutComponent>;
    let component: StalkerLiveStreamLayoutComponent;
    const playlist = signal({ _id: 'playlist-one', title: 'Portal One' });
    const channels = [
        {
            id: '10',
            cmd: 'ffrt4://itv/10',
            name: 'Chan 10',
            o_name: 'Chan 10',
            logo: 'ten.png',
        },
    ];
    const store = {
        getSelectedCategoryName: signal('All'),
        currentPlaylist: playlist,
        selectedContentType: signal<'itv' | 'radio'>('itv'),
        selectedCategoryId: signal<string | null>('all'),
        selectedItvId: signal<string | undefined>(channels[0].id),
        selectedItem: signal<(typeof channels)[number] | null>(null),
        itvChannels: signal(channels),
        radioChannels: signal([]),
        searchPhrase: signal(''),
        hasMoreChannels: signal(false),
        itvFullListActive: signal(false),
        itvSelectedCategoryFromCache: signal(false),
        itvFullListLoading: signal(false),
        itvFullListProgress: signal(null),
        itvFullChannelList: signal([]),
        isPaginatedContentLoading: signal(false),
        selectedItvEpgPrograms: signal([]),
        bulkItvEpgByChannel: signal({}),
        isLoadingBulkItvEpg: signal(false),
        setItvChannels: jest.fn(),
        setRadioChannels: jest.fn(),
        setPage: jest.fn(),
        preloadItvChannels: jest.fn(),
        applyMappedItvEpg: jest.fn(),
        clearBulkItvEpgCache: jest.fn(),
        ensureBulkItvEpg: jest.fn(),
        fetchChannelEpg: jest.fn(),
        resolveItvPlayback: jest.fn(),
        resolveRadioPlayback: jest.fn(),
        addToFavorites: jest.fn(),
        removeFromFavorites: jest.fn(),
        setSelectedItem: jest.fn(),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [StalkerLiveStreamLayoutComponent],
            providers: [
                { provide: StalkerStore, useValue: store },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: false,
                        isElectron: false,
                        supportsEpgMapping: false,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getPortalFavorites: () => of([]) },
                },
                {
                    provide: SettingsStore,
                    useValue: { openStreamOnDoubleClick: signal(false) },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openResolvedPlayback: jest.fn(),
                    },
                },
                {
                    provide: ElectronStreamHeadersService,
                    useValue: { apply: jest.fn(), clear: jest.fn() },
                },
                {
                    provide: LiveLayoutSidebarStateService,
                    useValue: { isCollapsed: signal(false), toggle: jest.fn() },
                },
                { provide: EpgRuntimeBridgeService, useValue: {} },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        })
            .overrideComponent(StalkerLiveStreamLayoutComponent, {
                set: { template: '' },
            })
            .compileComponents();
        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('offers programme details exactly for rows with a preview program', () => {
        const program = {
            title: 'Current Show',
            desc: 'Current description',
            channel: 'stalker-10',
            start: '2026-04-05 05:30:00',
            stop: '2026-04-05 06:00:00',
            category: null,
        } as never;
        component.epgPreviewPrograms.set('10', program);

        const rowWithProgram = { id: '10', name: 'Chan 10' } as never;
        const rowWithoutProgram = { id: '11', name: 'Chan 11' } as never;
        // supportsEpgMapping is false in this harness, so the programme is
        // the only thing that can justify a context menu.
        expect(component.hasChannelContextMenu(rowWithProgram)).toBe(true);
        expect(component.hasChannelContextMenu(rowWithoutProgram)).toBe(false);

        component.contextMenuChannel.set(rowWithProgram);
        expect(component.contextMenuProgram()).toBe(program);

        // The empty test template renders no menu trigger — stub it so the
        // action can close the menu it was invoked from.
        const closeMenu = jest.fn();
        Object.defineProperty(component, 'contextMenuTrigger', {
            value: () => ({ closeMenu }),
        });
        component.openProgramDetails();

        expect(closeMenu).toHaveBeenCalled();
        const dialog = TestBed.inject(MatDialog) as unknown as {
            open: jest.Mock;
        };
        expect(dialog.open).toHaveBeenCalledWith(EpgItemDescriptionComponent, {
            data: program,
        });
    });
});
