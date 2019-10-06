chrome.app.runtime.onLaunched.addListener(function() {
    chrome.app.window.create('index.html', {
        id: 'appWindow',
        frame: {
            color: '#11575c'
        },
        innerBounds: {
            width: 960,
            height: 540,
            minWidth: 340,
            minHeight: 540
        }
    });
});
