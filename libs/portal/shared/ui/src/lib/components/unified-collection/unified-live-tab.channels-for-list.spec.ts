import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import {
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import {
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';

/**
 * Focused spec for the `channelsForList` row mapping — kept separate from
 * the main layout spec, which sits at the max-lines test budget.
 */
describe('UnifiedLiveTabComponent channelsForList', () => {
    let fixture: ComponentFixture<UnifiedLiveTabComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), UnifiedLiveTabComponent],
            providers: [
                {
                    provide: StreamResolverService,
                    useValue: {
                        resolveLiveDetail: jest.fn(),
                        loadEpgForItems: jest
                            .fn()
                            .mockResolvedValue(new Map()),
                    },
                },
                {
                    provide: UnifiedRecentDataService,
                    useValue: { recordLivePlayback: jest.fn() },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsEpg: false },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        player: signal(VideoPlayer.VideoJs),
                        stripCountryPrefix: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: jest.fn().mockReturnValue(false),
                        openResolvedPlayback: jest.fn(),
                        openExternalPlayback: jest.fn(),
                    },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        })
            .overrideComponent(UnifiedLiveTabComponent, {
                set: { template: '' },
            })
            .compileComponents();

        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
    });

    afterEach(() => fixture.destroy());

    it('passes the archive fields through to the sidebar rows', () => {
        const item: UnifiedCollectionItem = {
            uid: 'xtream::pl-1::42',
            name: 'Archive Channel',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'pl-1',
            playlistName: 'Portal One',
            logo: null,
            posterUrl: null,
            xtreamId: 42,
            tvArchive: 1,
            tvArchiveDuration: 5,
            addedAt: '2026-04-30T12:00:00.000Z',
            position: 0,
        };
        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();

        const row = fixture.componentInstance.channelsForList()[0];
        expect(row.tvArchive).toBe(1);
        expect(row.tvArchiveDuration).toBe(5);
    });

    it('normalises absent archive fields to null', () => {
        const item = {
            uid: 'm3u::pl-2::chan',
            name: 'Plain Channel',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'pl-2',
            playlistName: 'Playlist Two',
            logo: null,
            posterUrl: null,
            addedAt: '2026-04-30T12:00:00.000Z',
            position: 0,
        } as UnifiedCollectionItem;
        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();

        const row = fixture.componentInstance.channelsForList()[0];
        expect(row.tvArchive).toBeNull();
        expect(row.tvArchiveDuration).toBeNull();
    });

    it('withholds radio rows from the fullscreen panel but keeps them on the page', () => {
        // A radio row plays through app-audio-player, which replaces the
        // app-web-player-view that owns fullscreen — picking one from the
        // panel would drop the user out of the mode it exists to keep.
        const base = {
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'pl-1',
            playlistName: 'Playlist One',
            logo: null,
            posterUrl: null,
            addedAt: '2026-04-30T12:00:00.000Z',
            position: 0,
        };
        const video = {
            ...base,
            uid: 'm3u::pl-1::tv',
            name: 'Video Channel',
            radio: 'false',
        } as UnifiedCollectionItem;
        const radio = {
            ...base,
            uid: 'm3u::pl-1::fm',
            name: 'Sample FM',
            radio: 'true',
        } as UnifiedCollectionItem;
        fixture.componentRef.setInput('items', [video, radio]);
        fixture.detectChanges();

        const component = fixture.componentInstance;
        expect(component.channelsForList()).toHaveLength(2);
        expect(
            component.fullscreenPanelChannels().map((row) => row.uid)
        ).toEqual([video.uid]);
    });
});
