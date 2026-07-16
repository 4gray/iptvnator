import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import { ControlsMenuState } from './controls-menu-state';

describe('ControlsMenuState', () => {
    it('keeps only one menu open at a time', () => {
        const menus = new ControlsMenuState();

        menus.open('volume');
        expect(menus.volumeOpen()).toBe(true);
        expect(menus.anyOpen()).toBe(true);

        menus.open('audio');
        expect(menus.volumeOpen()).toBe(false);
        expect(menus.audioOpen()).toBe(true);

        menus.toggle('audio');
        expect(menus.audioOpen()).toBe(false);
        expect(menus.anyOpen()).toBe(false);
    });

    it('closes all menus', () => {
        const menus = new ControlsMenuState();
        menus.open('speed');
        menus.closeAll();
        expect(menus.anyOpen()).toBe(false);
    });

    it.each(['volume', 'audio', 'subtitle', 'speed', 'aspect'] as const)(
        'closes an open %s menu when it becomes unavailable',
        (menu) => {
            const menus = new ControlsMenuState();
            menus.open(menu);

            const changed = menus.reconcile({
                volume: menu !== 'volume',
                audio: menu !== 'audio',
                subtitle: menu !== 'subtitle',
                speed: menu !== 'speed',
                aspect: menu !== 'aspect',
            });

            expect(changed).toBe(true);
            expect(menus.anyOpen()).toBe(false);
        }
    );

    it('leaves an available menu open without reporting a change', () => {
        const menus = new ControlsMenuState();
        menus.open('speed');

        expect(
            menus.reconcile({
                volume: true,
                audio: true,
                subtitle: true,
                speed: true,
                aspect: true,
            })
        ).toBe(false);
        expect(menus.speedOpen()).toBe(true);
    });

    it('closes every unavailable menu if state was made inconsistent', () => {
        const menus = new ControlsMenuState();
        menus.volumeOpen.set(true);
        menus.speedOpen.set(true);

        expect(
            menus.reconcile({
                volume: false,
                audio: false,
                subtitle: false,
                speed: false,
                aspect: false,
            })
        ).toBe(true);
        expect(menus.anyOpen()).toBe(false);
    });

    it.each([
        ['volume', { volume: false }, {}],
        ['audio', {}, { audioTracks: [] }],
        ['subtitle', {}, { subtitleTracks: [] }],
        ['speed', { playbackSpeed: false }, {}],
        ['aspect', { aspectRatio: false }, {}],
    ] as const)(
        'maps runtime controller state to %s menu availability',
        (menu, capabilityOverrides, stateOverrides) => {
            const menus = new ControlsMenuState();
            menus.open(menu);

            menus.reconcileControllerAvailability(
                true,
                {
                    ...DEFAULT_PLAYER_CAPABILITIES,
                    volume: true,
                    audioTracks: true,
                    subtitles: true,
                    playbackSpeed: true,
                    aspectRatio: true,
                    ...capabilityOverrides,
                },
                {
                    ...createEmptyControlsState(),
                    audioTracks: [
                        { id: 1, label: 'English', selected: true },
                        { id: 2, label: 'German', selected: false },
                    ],
                    subtitleTracks: [
                        { id: 1, label: 'English', selected: true },
                    ],
                    ...stateOverrides,
                }
            );

            expect(menus.anyOpen()).toBe(false);
        }
    );
});
