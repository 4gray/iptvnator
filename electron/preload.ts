import { Titlebar, TitlebarColor } from 'custom-electron-titlebar';

window.addEventListener('DOMContentLoaded', () => {
    new Titlebar({
        backgroundColor: TitlebarColor.fromHex('#1b1c1c'),
    });
});
