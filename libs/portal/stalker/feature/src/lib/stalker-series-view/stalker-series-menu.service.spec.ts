import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { SERIES_MENU_ACTION } from '@iptvnator/ui/components';
import { StalkerSeriesMenuService } from './stalker-series-menu.service';
import type { StalkerQuickStartButton } from './stalker-series-quick-start';

function button(
    overrides: Partial<StalkerQuickStartButton> = {}
): StalkerQuickStartButton {
    return {
        labelKey: 'XTREAM.PLAY_NEXT',
        episodeLabel: 'S01E02',
        icon: 'play_arrow',
        disabled: false,
        action: {
            kind: 'play-next',
            episode: { id: '1002', season: 1, episode_num: 2 },
        } as never,
        lazySeason: null,
        ...overrides,
    };
}

describe('StalkerSeriesMenuService', () => {
    const quickStart = signal<StalkerQuickStartButton | null>(null);
    let service: StalkerSeriesMenuService;

    beforeEach(() => {
        quickStart.set(button());
        TestBed.configureTestingModule({
            providers: [
                StalkerSeriesMenuService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: true },
                },
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.VLC) },
                },
            ],
        });
        service = TestBed.inject(StalkerSeriesMenuService);
        service.bind({
            quickStart,
            seasonContainer: signal(undefined),
            hasProgress: signal(false),
            playbackActive: signal(false),
            startPending: signal(false),
            resetProgress: jest.fn(),
            openExternal: jest.fn(),
        });
    });

    function externalRow() {
        return service
            .sections()
            .flatMap((section) => section.items)
            .find((item) => item.id === SERIES_MENU_ACTION.ExternalPlayer);
    }

    it('offers the next episode to the configured external player', () => {
        expect(externalRow()?.hint).toBe('VLC');
    });

    it('offers no external launch once the series is completed', () => {
        // The completed button still carries the last episode as its
        // action, disabled: a label, not something to launch.
        quickStart.set(button({ disabled: true }));
        expect(externalRow()).toBeUndefined();
    });
});
