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
});
