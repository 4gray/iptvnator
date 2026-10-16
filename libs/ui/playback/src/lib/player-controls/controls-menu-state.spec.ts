import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import { ControlsMenu, ControlsMenuState } from './controls-menu-state';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
} from './player-controls.model';

describe('ControlsMenuState', () => {
    it('keeps only one menu open at a time', () => {
        const menus = new ControlsMenuState();

        menus.open('volume');
        expect(menus.volumeOpen()).toBe(true);
        expect(menus.anyOpen()).toBe(true);

        menus.open('settings');
        expect(menus.volumeOpen()).toBe(false);
        expect(menus.settingsOpen()).toBe(true);

        menus.toggle('settings');
        expect(menus.settingsOpen()).toBe(false);
        expect(menus.anyOpen()).toBe(false);
    });

    it('closes all menus', () => {
        const menus = new ControlsMenuState();
        menus.open('settings');
        menus.closeAll();
        expect(menus.anyOpen()).toBe(false);
    });

    it('remembers the group the settings panel was opened for', () => {
        const menus = new ControlsMenuState();

        menus.openSettings('speed');
        expect(menus.settingsOpen()).toBe(true);
        expect(menus.settingsFocus()).toBe('speed');

        // Re-opening on another group keeps the panel and moves the focus.
        menus.openSettings('subtitles');
        expect(menus.settingsOpen()).toBe(true);
        expect(menus.settingsFocus()).toBe('subtitles');

        menus.close('settings');
        expect(menus.settingsFocus()).toBeNull();

        menus.openSettings('audio');
        menus.closeAll();
        expect(menus.settingsFocus()).toBeNull();
    });

    it.each(['volume', 'settings', 'stats'] as const)(
        'closes an open %s menu when it becomes unavailable',
        (menu) => {
            const menus = new ControlsMenuState();
            menus.open(menu);

            const changed = menus.reconcile({
                volume: menu !== 'volume',
                settings: menu !== 'settings',
                stats: menu !== 'stats',
            });

            expect(changed).toBe(true);
            expect(menus.anyOpen()).toBe(false);
        }
    );

    it('leaves an available menu open without reporting a change', () => {
        const menus = new ControlsMenuState();
        menus.open('settings');

        expect(
            menus.reconcile({ volume: true, settings: true, stats: true })
        ).toBe(false);
        expect(menus.settingsOpen()).toBe(true);
    });

    it('closes every unavailable menu if state was made inconsistent', () => {
        const menus = new ControlsMenuState();
        menus.volumeOpen.set(true);
        menus.settingsOpen.set(true);

        expect(
            menus.reconcile({ volume: false, settings: false, stats: false })
        ).toBe(true);
        expect(menus.anyOpen()).toBe(false);
    });

    it.each<
        [
            ControlsMenu,
            Partial<PlayerControlsCapabilities>,
            Partial<PlayerControlsState>,
        ]
    >([
        ['volume', { volume: false }, {}],
        ['stats', { streamStats: false }, {}],
        [
            'settings',
            {
                audioTracks: false,
                subtitles: false,
                externalSubtitles: false,
                qualityLevels: false,
                playbackSpeed: false,
                aspectRatio: false,
            },
            {},
        ],
        ['settings', { playbackSpeed: false, aspectRatio: false }, {}],
    ])(
        'maps runtime controller state to %s menu availability',
        (menu, capabilityOverrides, stateOverrides) => {
            const menus = new ControlsMenuState();
            menus.open(menu);

            menus.reconcileControllerAvailability(
                true,
                {
                    ...DEFAULT_PLAYER_CAPABILITIES,
                    volume: true,
                    streamStats: true,
                    playbackSpeed: true,
                    aspectRatio: true,
                    ...capabilityOverrides,
                },
                { ...createEmptyControlsState(), ...stateOverrides }
            );

            expect(menus.anyOpen()).toBe(false);
        }
    );

    it('keeps the settings panel while any group still exists', () => {
        const menus = new ControlsMenuState();
        menus.openSettings('speed');

        menus.reconcileControllerAvailability(
            true,
            {
                ...DEFAULT_PLAYER_CAPABILITIES,
                playbackSpeed: true,
                audioTracks: true,
            },
            {
                ...createEmptyControlsState(),
                audioTracks: [{ id: 1, label: 'Only', selected: true }],
            }
        );

        expect(menus.settingsOpen()).toBe(true);
    });

    it('closes every menu while controls are hidden', () => {
        const menus = new ControlsMenuState();
        menus.open('settings');

        menus.reconcileControllerAvailability(
            false,
            { ...DEFAULT_PLAYER_CAPABILITIES, playbackSpeed: true },
            createEmptyControlsState()
        );

        expect(menus.anyOpen()).toBe(false);
    });
});
