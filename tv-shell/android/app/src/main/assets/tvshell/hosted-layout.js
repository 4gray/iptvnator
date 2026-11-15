/* Installed at document start on the explicitly selected hosted main frame. */
(function () {
    'use strict';
    function applyViewport(create) {
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta && create && document.head) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'viewport');
            document.head.appendChild(meta);
        }
        if (meta && meta.getAttribute('content') !== window.__tvShellViewport) {
            meta.setAttribute('content', window.__tvShellViewport);
        }
    }
    var observer = new MutationObserver(function () { applyViewport(false); });
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['name', 'content'] });
    document.addEventListener('DOMContentLoaded', function () {
        applyViewport(true);
        observer.disconnect();
    }, { once: true });
    applyViewport(false);
})();
