import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type XtreamVodDetails,
} from '@iptvnator/shared/interfaces';
import {
    VOD_MENU_ACTION,
    VodDetailsMenuService,
} from './vod-details-menu.service';
import { VodDetailsMultiSourceUiService } from './vod-details-multi-source-ui.service';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';

describe('VodDetailsMenuService', () => {
    const playbackStartPending = signal(false);
    const isExternalLaunchPending = signal(false);
    const hasPlaybackPosition = signal(true);
    let service: VodDetailsMenuService;

    beforeEach(() => {
        playbackStartPending.set(false);
        isExternalLaunchPending.set(false);
        TestBed.configureTestingModule({
            providers: [
                VodDetailsMenuService,
                { provide: XtreamStore, useValue: {} },
                {
                    provide: VodDetailsPlaybackService,
                    useValue: {
                        routePlaybackPosition: signal(null),
                        playbackStartPending,
                        isExternalLaunchPending,
                        isExternalStopAction: signal(false),
                        inlinePlayback: signal(null),
                    },
                },
                {
                    provide: VodDetailsMultiSourceUiService,
                    useValue: { hasPlaybackPosition },
                },
                {
                    provide: VodMultiSourceHostService,
                    useValue: {
                        hasAlternatives: signal(false),
                        alternativeCount: signal(0),
                    },
                },
                { provide: PORTAL_PLAYBACK_POSITIONS, useValue: {} },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: true },
                },
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.MPV) },
                },
                { provide: Router, useValue: { navigate: jest.fn() } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(VodDetailsMenuService);
        service.bind({
            item: signal({ info: { name: 'Movie' } } as XtreamVodDetails),
            vodId: signal(7),
            category: signal(null),
            restart: jest.fn(),
        });
    });

    function row(id: string) {
        return service
            .sections()
            .flatMap((section) => section.items)
            .find((item) => item.id === id);
    }

    it('offers the external player and Start over rows while nothing starts', () => {
        expect(row(VOD_MENU_ACTION.ExternalPlayer)?.disabled).toBeFalsy();
        expect(row(VOD_MENU_ACTION.StartOver)?.disabled).toBeFalsy();
    });

    it('holds both rows while a start resolves or a launch awaits the player', () => {
        // Another start would be refused while one is in flight: an enabled
        // row would close the menu and do nothing.
        playbackStartPending.set(true);
        expect(row(VOD_MENU_ACTION.ExternalPlayer)?.disabled).toBe(true);
        expect(row(VOD_MENU_ACTION.StartOver)?.disabled).toBe(true);

        playbackStartPending.set(false);
        isExternalLaunchPending.set(true);
        expect(row(VOD_MENU_ACTION.ExternalPlayer)?.disabled).toBe(true);
        expect(row(VOD_MENU_ACTION.StartOver)?.disabled).toBe(true);
    });
});
