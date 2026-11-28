const { BrowserWindow } = require('electron');

BrowserWindow.prototype.show = () => {
    // The app creates its main window hidden. Playwright can drive its
    // renderer and take screenshots without showing the native window.
};
