import { Color, Titlebar } from 'custom-electron-titlebar';

window.addEventListener('DOMContentLoaded', () => {
    new Titlebar({
        backgroundColor: Color.fromHex('#000'),
        itemBackgroundColor: Color.fromHex('#222'),
        enableMnemonics: true,
    });
});
