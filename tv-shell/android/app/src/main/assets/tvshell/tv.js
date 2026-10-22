/*
 * IPTVnator TV shell — remote-control layer.
 *
 * Loaded by the shell's local server before the Angular bundle (same-origin
 * script, so the app's CSP `script-src 'self'` allows it). It does not touch
 * IPTVnator's code: it only listens to key events and drives focus.
 *
 *   D-pad            → spatial navigation between the app's focusable elements
 *                      (Android's FocusFinder algorithm), with "scroll and look
 *                      again" for virtual-scroll lists.
 *   Center / Enter   → activation (native for buttons/links, synthesized click
 *                      for elements this layer made focusable, fullscreen on a
 *                      focused <video> — external player when it cannot play the
 *                      format (or video.js is in error) —,
 *                      soft keyboard on text fields).
 *   Back             → window.__tvShell.back(): closes overlays (Escape), leaves
 *                      fullscreen, goes back in history, finally asks the shell
 *                      to exit.
 *   Menu             → window.__tvShell.menu(): context menu on the focused item.
 *   Media keys       → window.__tvShell.media('playpause' | 'rewind' | ...).
 *
 * The Android side exposes `window.TvShell` (JavascriptInterface). Without it
 * (plain browser) a console stub is used and F9/F10/F8/F7 emulate Back/Menu/
 * Play-Pause/External player.
 */
(function () {
    'use strict';

    if (window.__tvShell) {
        return;
    }

    var DIR = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    var FOCUS_CLASS = 'tv-focus';
    var MADE_FOCUSABLE = 'data-tv-focusable';
    var MEDIA_URL_RE = /\.(m3u8|m3u|ts|mp4|mkv|avi|mov|webm|mpd|aac|mp3|flac)(\?|#|$)|\/(live|movie|movies|series|play|stream|hls|dash|radio)\//i;

    var bridge = window.TvShell || null;
    var isAndroid = !!bridge;
    var api = {};
    var lastRect = null; // where focus last was, for recycled/removed elements
    var lastMediaUrl = null;
    // MediaSource playback sessions (see installMediaSourceTracking): the first
    // request of a session is the stream, later ones never replace it.
    var session = null;     // { pinned, seen } while an MSE engine is attached
    var prevSession = null; // { pin, seen } of the session before it
    var lastMediaTitle = null;
    var currentVideo = null;
    var navDepth = 0;
    var exitArmedUntil = 0;
    var lastArrowAt = 0;
    var heldArrow = null; // arrow pressed and not released yet: only its keydowns can be queued repeats
    var keepScreenOn = false;

    // --------------------------------------------------------------- bridge
    function native(method) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (bridge && typeof bridge[method] === 'function') {
            try {
                return bridge[method].apply(bridge, args);
            } catch (e) {
                log('bridge.' + method + ' failed: ' + e);
            }
        } else {
            log('bridge.' + method + '(' + args.map(String).join(', ') + ')');
        }
        return undefined;
    }

    function log(message) {
        if (window.__tvShellDebug || !isAndroid) {
            try {
                console.log('[tvshell] ' + message);
            } catch (e) {
                /* ignore */
            }
        }
    }

    // ---------------------------------------------------------------- style
    function installStyle() {
        var style = document.createElement('style');
        style.setAttribute('data-tvshell', '');
        style.textContent =
            '.' + FOCUS_CLASS + '{outline:3px solid var(--app-focus-ring,#7cc4ff)!important;outline-offset:2px!important;' +
            'scroll-margin:32px;box-shadow:0 0 0 3px rgba(0,0,0,.55)!important;border-radius:6px}' +
            'video.' + FOCUS_CLASS + '{outline-offset:-3px!important}' +
            'body.tv-shell *{cursor:none!important}' +
            'body.tv-shell ::-webkit-scrollbar{width:0;height:0}';
        (document.head || document.documentElement).appendChild(style);
    }

    // ------------------------------------------------------------- geometry
    function rectOf(el) {
        var r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }

    function isVisible(el) {
        if (!el.isConnected) return false;
        // The geometry first: it rejects most of a long list before the ancestor walk and the style.
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
        if (el.closest('[hidden],[inert],[aria-hidden="true"],.cdk-visually-hidden,.cdk-overlay-backdrop')) return false;
        var cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0' || cs.pointerEvents === 'none') return false;
        return true;
    }

    function isDisabled(el) {
        return el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('mat-mdc-button-disabled');
    }

    var CANDIDATE_SELECTOR = [
        'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'video', 'audio[controls]',
        '[tabindex]', '[contenteditable="true"]',
        '[role="button"]', '[role="link"]', '[role="option"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
        '[role="menuitemradio"]', '[role="tab"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
        '[role="treeitem"]', '[role="gridcell"]', '[role="slider"]', '[role="combobox"]', '[role="listitem"]',
        '.mat-mdc-list-item', '.mat-mdc-card', '.mat-mdc-chip', 'mat-chip', 'mat-card', '[mat-ripple]', '[matripple]', '.mat-mdc-tab'
    ].join(',');

    var NATIVE_FOCUSABLE = /^(a|button|input|select|textarea|summary|iframe)$/i;

    function isNativelyFocusable(el) {
        if (NATIVE_FOCUSABLE.test(el.tagName)) return !(el.tagName === 'A' && !el.hasAttribute('href'));
        if (el.hasAttribute('contenteditable')) return true;
        var tabindex = el.getAttribute('tabindex');
        return tabindex !== null && Number(tabindex) >= 0;
    }

    /** Elements with an interactive role but no tabindex are made focusable. */
    function ensureFocusable(el) {
        if (isNativelyFocusable(el)) return true;
        var tabindex = el.getAttribute('tabindex');
        if (tabindex !== null) {
            // tabindex=-1: programmatic focus target (menu items, options, scroll
            // owners). Only keep the ones that are real actions.
            return !!el.getAttribute('role') || el.tagName === 'VIDEO' || el.hasAttribute(MADE_FOCUSABLE);
        }
        var role = el.getAttribute('role');
        var clickable = role || el.tagName === 'VIDEO' || /mat-mdc-list-item|mat-mdc-card|mat-mdc-chip|mat-mdc-tab/.test(el.className || '') ||
            /^(mat-chip|mat-card)$/i.test(el.tagName) || el.hasAttribute('mat-ripple') || el.hasAttribute('matripple');
        if (!clickable) return false;
        el.setAttribute('tabindex', '-1');
        el.setAttribute(MADE_FOCUSABLE, '');
        return true;
    }

    /** Overlay content that is not a place to navigate in: toasts and tooltips. */
    var TOAST_SELECTOR = '.mat-mdc-snack-bar-container,mat-snack-bar-container,[role="status"],[role="alert"],[role="tooltip"]';

    /** Topmost overlay pane that owns focus, or the modal on top, or the document. */
    function navigationScope() {
        var active = document.activeElement;
        if (active && active !== document.body) {
            var pane = active.closest('.cdk-overlay-pane');
            // A snack bar's action button must not lock the D-pad into the toast while it shows.
            if (pane && !pane.querySelector(TOAST_SELECTOR)) return pane;
        }
        var backdrop = document.querySelector('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing');
        if (backdrop) {
            var panes = document.querySelectorAll('.cdk-overlay-pane');
            for (var i = panes.length - 1; i >= 0; i--) {
                if (panes[i].querySelector('[role="dialog"],mat-dialog-container,mat-bottom-sheet-container,[role="menu"],[role="listbox"]')) return panes[i];
            }
            if (panes.length) return panes[panes.length - 1];
        }
        return document;
    }

    function candidates(scope, exclude) {
        var nodes = scope.querySelectorAll(CANDIDATE_SELECTOR);
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (el === exclude || isDisabled(el)) continue;
            if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
            if (!isVisible(el)) continue;
            if (!ensureFocusable(el)) continue;
            // Landing zones (dialog container, scroll owners, detail shells)
            // are never navigation targets: their children are.
            if (isContainerFocus(el)) continue;
            out.push({ el: el, rect: rectOf(el) });
        }
        return out;
    }

    // Android FocusFinder (frameworks/base/core/java/android/view/FocusFinder.java)
    function isCandidate(src, dest, dir) {
        var cx = (src.left + src.right) / 2;
        var cy = (src.top + src.bottom) / 2;
        switch (dir) {
            case 'left': return (src.right > dest.right || src.left >= dest.right) && src.left > dest.left && dest.right <= cx;
            case 'right': return (src.left < dest.left || src.right <= dest.left) && src.right < dest.right && dest.left >= cx;
            case 'up': return (src.bottom > dest.bottom || src.top >= dest.bottom) && src.top > dest.top && dest.bottom <= cy;
            case 'down': return (src.top < dest.top || src.bottom <= dest.top) && src.bottom < dest.bottom && dest.top >= cy;
        }
        return false;
    }

    function beamsOverlap(dir, a, b) {
        if (dir === 'left' || dir === 'right') return b.bottom > a.top && b.top < a.bottom;
        return b.right > a.left && b.left < a.right;
    }

    function isToDirectionOf(dir, src, dest) {
        switch (dir) {
            case 'left': return src.left >= dest.right;
            case 'right': return src.right <= dest.left;
            case 'up': return src.top >= dest.bottom;
            case 'down': return src.bottom <= dest.top;
        }
        return false;
    }

    function majorAxisDistance(dir, src, dest) {
        var d;
        switch (dir) {
            case 'left': d = src.left - dest.right; break;
            case 'right': d = dest.left - src.right; break;
            case 'up': d = src.top - dest.bottom; break;
            default: d = dest.top - src.bottom;
        }
        return Math.max(0, d);
    }

    function majorAxisDistanceToFarEdge(dir, src, dest) {
        var d;
        switch (dir) {
            case 'left': d = src.left - dest.left; break;
            case 'right': d = dest.right - src.right; break;
            case 'up': d = src.top - dest.top; break;
            default: d = dest.bottom - src.bottom;
        }
        return Math.max(1, d);
    }

    function minorAxisDistance(dir, src, dest) {
        if (dir === 'left' || dir === 'right') return Math.abs((src.top + src.bottom) / 2 - (dest.top + dest.bottom) / 2);
        return Math.abs((src.left + src.right) / 2 - (dest.left + dest.right) / 2);
    }

    function weightedDistance(major, minor) {
        return 13 * major * major + minor * minor;
    }

    function beamBeats(dir, src, r1, r2) {
        var r1InBeam = beamsOverlap(dir, src, r1);
        var r2InBeam = beamsOverlap(dir, src, r2);
        if (r2InBeam || !r1InBeam) return false;
        if (!isToDirectionOf(dir, src, r2)) return true;
        if (dir === 'left' || dir === 'right') return true;
        return majorAxisDistance(dir, src, r1) < majorAxisDistanceToFarEdge(dir, src, r2);
    }

    function isBetterCandidate(dir, src, r1, r2) {
        if (!isCandidate(src, r1, dir)) return false;
        if (!isCandidate(src, r2, dir)) return true;
        if (beamBeats(dir, src, r1, r2)) return true;
        if (beamBeats(dir, src, r2, r1)) return false;
        return weightedDistance(majorAxisDistance(dir, src, r1), minorAxisDistance(dir, src, r1)) <
            weightedDistance(majorAxisDistance(dir, src, r2), minorAxisDistance(dir, src, r2));
    }

    function findNext(dir, srcRect, scope, exclude) {
        var list = candidates(scope, exclude);
        var best = null;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (exclude && (exclude.contains(c.el) || c.el.contains(exclude))) {
                // nested: a card and the button inside it. Allow leaving a child
                // for its parent only when the parent is in the direction.
                if (!isCandidate(srcRect, c.rect, dir)) continue;
            }
            if (best === null) {
                if (isCandidate(srcRect, c.rect, dir)) best = c;
            } else if (isBetterCandidate(dir, srcRect, c.rect, best.rect)) {
                best = c;
            }
        }
        return best;
    }

    // ------------------------------------------------------------ scrolling
    function scrollableAncestor(el, dir) {
        var node = el && el !== document ? el.parentElement : null;
        var vertical = dir === 'up' || dir === 'down';
        while (node && node !== document.body && node !== document.documentElement) {
            var cs = getComputedStyle(node);
            var overflow = vertical ? cs.overflowY : cs.overflowX;
            if (/(auto|scroll|overlay)/.test(overflow)) {
                var canScroll = vertical ? node.scrollHeight > node.clientHeight + 1 : node.scrollWidth > node.clientWidth + 1;
                if (canScroll) return node;
            }
            node = node.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    function scrollInDirection(scroller, dir) {
        var before = dir === 'up' || dir === 'down' ? scroller.scrollTop : scroller.scrollLeft;
        var vertical = dir === 'up' || dir === 'down';
        var amount = vertical ? Math.max(80, scroller.clientHeight * 0.6) : Math.max(80, scroller.clientWidth * 0.6);
        var delta = dir === 'up' || dir === 'left' ? -amount : amount;
        // Never animated: the next decision reads the rects right away, and a rail with
        // `scroll-behavior: smooth` would still be moving.
        try {
            scroller.scrollTo({ top: vertical ? before + delta : scroller.scrollTop, left: vertical ? scroller.scrollLeft : before + delta, behavior: 'instant' });
        } catch (e) {
            if (vertical) scroller.scrollTop = before + delta;
            else scroller.scrollLeft = before + delta;
        }
        var after = vertical ? scroller.scrollTop : scroller.scrollLeft;
        return after !== before;
    }

    // ---------------------------------------------------------------- focus
    function setFocus(el, opts) {
        var previous = document.querySelectorAll('.' + FOCUS_CLASS);
        for (var i = 0; i < previous.length; i++) previous[i].classList.remove(FOCUS_CLASS);
        try {
            el.focus({ preventScroll: true });
        } catch (e) {
            el.focus();
        }
        el.classList.add(FOCUS_CLASS);
        try {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); // never animated
        } catch (e) {
            try {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } catch (e2) {
                /* ignore */
            }
        }
        lastRect = rectOf(el);
        if (!(opts && opts.silent)) revealPlayerControls(el);
    }

    function sourceRect() {
        var active = document.activeElement;
        if (active && active !== document.body && isVisible(active)) return rectOf(active);
        if (lastRect) return lastRect;
        return { left: -1, top: -1, right: 0, bottom: 0, width: 1, height: 1 };
    }

    var INTERACTIVE_ROLE = /^(button|link|option|menuitem|menuitemcheckbox|menuitemradio|tab|checkbox|radio|switch|treeitem|gridcell|slider|combobox|textbox|searchbox|spinbutton|listitem)$/;

    /** A focus landing zone (dialog container, scroll owner, detail page) rather than an action. */
    function isContainerFocus(el) {
        if (!el || el === document.body) return false;
        if (NATIVE_FOCUSABLE.test(el.tagName) || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return false;
        var role = el.getAttribute('role');
        if (role && INTERACTIVE_ROLE.test(role)) return false;
        if (el.hasAttribute(MADE_FOCUSABLE)) return false;
        var inner = el.querySelector(CANDIDATE_SELECTOR);
        return !!inner;
    }

    function enterContainer(container) {
        var list = candidates(container, container);
        if (!list.length) return false;
        var origin = lastRect && !(lastRect.left === container.getBoundingClientRect().left && lastRect.top === container.getBoundingClientRect().top)
            ? lastRect : { left: -1e4, top: -1e4, right: -1e4, bottom: -1e4 };
        var best = null, bestScore = Infinity;
        for (var i = 0; i < list.length; i++) {
            var r = list[i].rect;
            var score = r.top * 3 + r.left; // reading order, top-left first
            if (origin.left > -1e4) {
                var dx = (r.left + r.right) / 2 - (origin.left + origin.right) / 2;
                var dy = (r.top + r.bottom) / 2 - (origin.top + origin.bottom) / 2;
                score = dx * dx + dy * dy;
            }
            if (score < bestScore) {
                bestScore = score;
                best = list[i];
            }
        }
        setFocus(best.el);
        return true;
    }

    function move(dir, retried) {
        var scope = navigationScope();
        var active = document.activeElement;
        if (!retried && isContainerFocus(active) && enterContainer(active)) return true;
        var exclude = active && active !== document.body ? active : null;
        var src = sourceRect();
        if (exclude && (exclude.tagName === 'VIDEO' || exclude.tagName === 'AUDIO')) {
            // The picture is huge and its controls sit inside it: navigate
            // from its centre so overlay buttons count as "above"/"below".
            var cx = (src.left + src.right) / 2, cy = (src.top + src.bottom) / 2;
            src = { left: cx - 1, top: cy - 1, right: cx + 1, bottom: cy + 1, width: 2, height: 2 };
        }
        var next = findNext(dir, src, scope, exclude);
        if (next) {
            setFocus(next.el);
            return true;
        }
        if (!retried) {
            var scroller = scrollableAncestor(exclude || (scope === document ? document.body : scope), dir);
            if (scroller && scrollInDirection(scroller, dir)) {
                // Virtual scroll renders rows asynchronously: look again shortly.
                setTimeout(function () {
                    move(dir, true);
                }, 60);
                return true;
            }
        }
        return false;
    }

    function focusFirst(scope, exclude) {
        scope = scope || navigationScope();
        var list = candidates(scope, exclude || null);
        if (!list.length) return false;
        // Prefer whatever is closest to where focus last was, else top-left.
        var origin = lastRect || { left: 0, top: 0, right: 0, bottom: 0 };
        var best = null, bestScore = Infinity;
        for (var i = 0; i < list.length; i++) {
            var r = list[i].rect;
            var dx = (r.left + r.right) / 2 - (origin.left + origin.right) / 2;
            var dy = (r.top + r.bottom) / 2 - (origin.top + origin.bottom) / 2;
            var score = dx * dx + dy * dy + 1;
            // Content beats chrome: rows, cards and links over icon buttons,
            // the main area over toolbars and rails.
            var el = list[i].el;
            if (/mat-mdc-icon-button/.test(el.className || '')) score *= 3;
            if (scope === document && !el.closest('main,[role="main"],.cdk-overlay-pane')) score *= 2;
            if (el.closest(TOAST_SELECTOR)) score *= 4;
            if (score < bestScore) {
                bestScore = score;
                best = list[i];
            }
        }
        setFocus(best.el, { silent: true });
        return true;
    }

    // -------------------------------------------------- app widget handling
    // The browser still needs the key while the caret can move that way; once it
    // cannot, the D-pad leaves the field (the Android EditText behaviour).
    function caretCanMove(el, dir) {
        var start = el.selectionStart, end = el.selectionEnd;
        if (typeof start !== 'number' || typeof end !== 'number') return el.value.length > 0; // email/number: null in Chrome
        if (start !== end) return true;
        if (dir === 'left' || dir === 'up') return start > 0;
        return end < el.value.length;
    }

    function passThroughArrow(el, dir) {
        if (!el || el === document.body) return false;
        var horizontal = dir === 'left' || dir === 'right';
        var tag = el.tagName;
        // On the video: Left/Right stay with the app (seek); Up/Down navigate
        // to the player controls and the rest of the page (the TV remote owns
        // the volume anyway).
        if (tag === 'VIDEO' || tag === 'AUDIO') return horizontal;
        if (tag === 'INPUT') {
            var type = (el.getAttribute('type') || 'text').toLowerCase();
            if (type === 'range') return horizontal;
            if (/^(text|search|url|email|password|tel|number)$/.test(type)) return horizontal && caretCanMove(el, dir);
            if (type === 'radio') return true;
            return false;
        }
        if (tag === 'TEXTAREA') return caretCanMove(el, dir);
        if (el.isContentEditable) return true; // no value/selection to inspect
        var role = el.getAttribute('role');
        if (role === 'slider') return horizontal;
        if (role === 'combobox' && el.getAttribute('aria-expanded') === 'true') return true;
        if (el.closest('[role="menu"],[role="menubar"],[role="listbox"],mat-option,.mat-mdc-autocomplete-panel')) return !horizontal || !!el.closest('[role="menubar"]');
        if (el.closest('.mat-mdc-slider,mat-slider')) return horizontal;
        if (el.closest('[data-tv-passthrough]')) return true;
        return false;
    }

    function revealPlayerControls(el) {
        var player = el.closest && el.closest('[class*="player"],[class*="controls"],video,.vjs-tech');
        if (!player) return;
        var target = player.tagName === 'VIDEO' ? player.parentElement || player : player;
        try {
            // The shared controls surface (libs/ui/playback player-controls) reveals on
            // pointermove only; a synthetic MouseEvent never reaches those listeners.
            // pointerType 'mouse': the surface ignores 'touch'.
            if (window.PointerEvent) {
                target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', isPrimary: true, clientX: 10, clientY: 10 }));
            }
            target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 })); // legacy video.js chrome
        } catch (e) {
            /* ignore */
        }
    }

    /** Tells the shell whether the screen must stay on (something plays in the document). */
    function syncKeepScreenOn(startedPlaying) {
        var playing = startedPlaying === true || anyMediaPlaying();
        if (playing === keepScreenOn) return;
        keepScreenOn = playing;
        native('setKeepScreenOn', playing);
    }

    function anyMediaPlaying() {
        var media = document.querySelectorAll('video,audio');
        for (var i = 0; i < media.length; i++) {
            if (!media[i].paused && !media[i].ended) return true;
        }
        return false;
    }

    function activeVideo() {
        // The element of a player page the user left keeps its source: playing it would be
        // ghost audio with no interface to stop it.
        if (currentVideo && !currentVideo.isConnected) currentVideo = null;
        var videos = document.querySelectorAll('video,audio');
        var best = null, bestArea = -1;
        for (var i = 0; i < videos.length; i++) {
            var v = videos[i];
            if (!v.isConnected) continue;
            var r = v.getBoundingClientRect();
            var area = r.width * r.height;
            if (!v.paused && v.readyState > 0) area += 1e9; // playing wins
            if (area > bestArea) {
                bestArea = area;
                best = v;
            }
        }
        return best || currentVideo;
    }

    // ------------------------------------------------------------ key input
    function onKeyDown(event) {
        if (event.defaultPrevented && !event.__tvshell) return;
        var dir = DIR[event.key];
        var active = document.activeElement;
        if (dir) {
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            // A held key repeats every 50 ms, faster than a step through a long list: the
            // repeats that waited in the queue would keep moving focus after the key is released.
            var now = performance.now();
            if (heldArrow === event.key && now - lastArrowAt < 250 && now - event.timeStamp > 120) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            heldArrow = event.key;
            lastArrowAt = now;
            if (passThroughArrow(active, dir)) {
                revealPlayerControls(active);
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            if (active && (active.tagName === 'VIDEO' || active.tagName === 'AUDIO')) {
                // Controls auto-hide: bring them back, then look for them.
                revealPlayerControls(active);
                if (!move(dir)) setTimeout(function () { move(dir); }, 120);
                return;
            }
            if (!move(dir)) {
                revealPlayerControls(active || document.body);
            }
            return;
        }
        if (event.key === 'Enter') {
            if (!active || active === document.body) {
                if (focusFirst()) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
                return;
            }
            if (active.tagName === 'VIDEO' || active.tagName === 'AUDIO') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (isUnplayable(active)) api.openExternal();
                else toggleFullscreen(active);
                return;
            }
            if (active.tagName === 'INPUT' && /^(text|search|url|email|password|tel|number)$/.test((active.getAttribute('type') || 'text').toLowerCase())) {
                native('showKeyboard');
                return; // let the app submit on Enter if it wants to
            }
            if (active.hasAttribute(MADE_FOCUSABLE)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                active.click();
            }
            return;
        }
        if (!isAndroid) {
            // Browser emulation of the remote's special keys.
            if (event.key === 'F9') { event.preventDefault(); api.back(); }
            else if (event.key === 'F10') { event.preventDefault(); api.menu(); }
            else if (event.key === 'F8') { event.preventDefault(); api.media('playpause'); }
            else if (event.key === 'F7') { event.preventDefault(); api.openExternal(); }
        }
    }

    /** A format the engine cannot play (decode / not supported), unlike a dropped connection. */
    function isUnplayable(media) {
        return (media.error && media.error.code >= 3) || hasPlayerError(media);
    }

    function hasPlayerError(media) {
        var root = media.closest && media.closest('.video-js');
        if (root && root.player && typeof root.player.error === 'function') {
            try {
                return !!root.player.error();
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    /** Select on the picture: go fullscreen (Back leaves it again). */
    function toggleFullscreen(media) {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(function () { /* ignore */ });
            return;
        }
        // The app owns fullscreen: its F shortcut (player-controls ControlsShortcuts) puts
        // the right surface in fullscreen for every player, dock, title and channel panel
        // included, and calls preventDefault when it handled the key. Still inside the
        // trusted Enter keydown, so requestFullscreen keeps its user activation.
        var shortcut = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', keyCode: 70, which: 70, bubbles: true, cancelable: true });
        shortcut.__tvshell = true;
        media.dispatchEvent(shortcut);
        if (shortcut.defaultPrevented) {
            setTimeout(function () { setFocus(media, { silent: true }); }, 300);
            return;
        }
        // Fallback (no shortcut owner attached): the player shell first, then vendor roots.
        var root = media.closest('[class*="player-shell"],.video-js,.art-video-player,[class*="player-container"],[class*="player__"]') || media.parentElement || media;
        var request = root.requestFullscreen || root.webkitRequestFullscreen;
        if (request) {
            try {
                var p = request.call(root);
                if (p && p.catch) p.catch(function () { /* ignore */ });
            } catch (e) {
                /* ignore */
            }
            setTimeout(function () { setFocus(media, { silent: true }); }, 300);
        } else {
            toggleMedia(media);
        }
    }

    function toggleMedia(media) {
        if (!media) return;
        if (media.paused) {
            var p = media.play();
            if (p && p.catch) p.catch(function () { /* ignore */ });
        } else {
            media.pause();
        }
    }

    // --------------------------------------------------------- public API
    api.move = function (dir) {
        return move(dir);
    };

    api.focusFirst = function () {
        return focusFirst();
    };

    /** Back button. Returns true when consumed by the page. */
    api.back = function () {
        var active = document.activeElement;
        // Open overlay (dialog, menu, select panel, bottom sheet, popover): Escape closes it.
        var pane = document.querySelector('.cdk-overlay-pane [role="dialog"],.cdk-overlay-pane [role="menu"],.cdk-overlay-pane [role="listbox"],.cdk-overlay-pane mat-bottom-sheet-container,.cdk-overlay-pane .mat-mdc-autocomplete-panel');
        if (pane) {
            var target = active && pane.contains(active) ? active : pane;
            var ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
            ev.__tvshell = true;
            target.dispatchEvent(ev);
            document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
            setTimeout(function () {
                if (!document.activeElement || document.activeElement === document.body) focusFirst();
            }, 120);
            return true;
        }
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(function () { /* ignore */ });
            return true;
        }
        // Focus parked on the video: leave "player mode" first. The video is
        // itself a candidate, so it is excluded here; with nothing else to land
        // on (a bare player page) Back falls through to the page-level Back.
        if (active && (active.tagName === 'VIDEO' || active.tagName === 'AUDIO')) {
            active.blur();
            lastRect = rectOf(active);
            if (focusFirst(null, active)) return true;
        }
        // The app's own page-level Back lives in the workspace header. Match it by its
        // stable hooks (component class and the test id upstream relies on), not by the
        // aria-label, which is translated and overridden on detail pages.
        var headerBack = document.querySelector('[data-tv-back],.header-back,[data-test-id="workspace-header-back"]');
        if (headerBack && isVisible(headerBack) && !isDisabled(headerBack)) {
            headerBack.click();
            scheduleRefocus();
            return true;
        }
        if (canGoBackInApp()) {
            history.back(); // popstate decrements the fallback counter
            scheduleRefocus();
            return true;
        }
        var now = Date.now();
        if (now < exitArmedUntil) {
            native('exitApp');
            return true;
        }
        exitArmedUntil = now + 2500;
        native('showExitHint');
        return false;
    };

    /** Menu button: open the context menu of the focused element. */
    api.menu = function () {
        var active = document.activeElement;
        if (!active || active === document.body) {
            if (!focusFirst()) return false;
            active = document.activeElement;
        }
        if (active.tagName === 'VIDEO' || active.tagName === 'AUDIO') {
            return api.openExternal();
        }
        var r = active.getBoundingClientRect();
        var ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2 });
        active.dispatchEvent(ev);
        setTimeout(function () {
            var pane = document.querySelector('.cdk-overlay-pane [role="menu"]');
            if (pane) {
                var first = pane.querySelector('[role="menuitem"]:not([disabled])');
                if (first) setFocus(first, { silent: true });
            }
        }, 150);
        return true;
    };

    /** Media keys from the remote. */
    api.media = function (action) {
        var media = activeVideo();
        if (!media || !media.isConnected) return false;
        switch (action) {
            case 'playpause': toggleMedia(media); break;
            case 'play': toggleMedia(media.paused ? media : null); break;
            case 'pause': if (!media.paused) media.pause(); break;
            case 'stop': media.pause(); try { media.currentTime = 0; } catch (e) { /* live */ } break;
            case 'rewind': try { media.currentTime = Math.max(0, media.currentTime - 15); } catch (e) { /* live */ } break;
            case 'fastforward': try { media.currentTime = media.currentTime + 30; } catch (e) { /* live */ } break;
            default: return false;
        }
        revealPlayerControls(media);
        return true;
    };

    /** Hand the current stream to an external Android player (VLC, ...). */
    api.openExternal = function () {
        var url = api.currentStreamUrl();
        if (!url) {
            native('toast', 'No stream to open');
            return false;
        }
        native('openExternal', url, lastMediaTitle || document.title || '');
        return true;
    };

    /** The stream the app is (trying to) play: video.js keeps the original
     *  source on its player object even when no tech could play it. */
    function videoJsSource() {
        var roots = document.querySelectorAll('.video-js');
        for (var i = 0; i < roots.length; i++) {
            var player = roots[i].player;
            if (!player) continue;
            try {
                var src = typeof player.currentSrc === 'function' ? player.currentSrc() : '';
                if (!src && player.cache_ && player.cache_.sources && player.cache_.sources.length) src = player.cache_.sources[0].src;
                if (src && /^(https?|rtsp|rtmp):/i.test(src)) return src;
            } catch (e) {
                /* ignore */
            }
        }
        return null;
    }

    api.currentStreamUrl = function () {
        var fromVjs = videoJsSource();
        if (fromVjs) return fromVjs;
        var media = activeVideo();
        if (media) {
            var src = media.currentSrc || media.getAttribute('src') || '';
            if (/^(https?|rtsp|rtmp):/i.test(src)) return src;
        }
        return lastMediaUrl;
    };

    api.state = function () {
        var active = document.activeElement;
        return {
            active: active && active !== document.body ? describe(active) : null,
            lastMediaUrl: lastMediaUrl,
            navDepth: navDepth,
            canGoBack: canGoBackInApp(),
            scope: navigationScope() === document ? 'document' : 'overlay'
        };
    };

    function describe(el) {
        var label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
        if (!label && el.labels && el.labels.length) label = el.labels[0].textContent.trim();
        if (!label && el.getAttribute('aria-labelledby')) {
            var byId = document.getElementById(el.getAttribute('aria-labelledby'));
            if (byId) label = byId.textContent.trim();
        }
        return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '') +
            (label ? '[' + label.slice(0, 40) + ']' : '') + (el.textContent ? ' "' + el.textContent.trim().slice(0, 40) + '"' : '');
    }

    // ------------------------------------------------ media URL tracking
    // Never a stream: provider APIs, metadata, artwork, subtitles, page assets,
    // and the API hosts the page itself calls (TMDB metadata, the update check).
    var NOT_STREAM_RE = /\/(player_api|portal|get)\.php|\.(json|xml|png|jpe?g|webp|gif|svg|ico|css|js|woff2?|ttf|vtt|srt)(\?|#|$)/i;
    var NOT_STREAM_HOST_RE = /^https?:\/\/(api\.themoviedb\.org|image\.tmdb\.org|api\.github\.com)(:\d+)?([\/?#]|$)/i;
    // Schemes a stream can have; only http(s) can be one of our own files.
    var STREAM_SCHEME_RE = /^(https?|rtmps?|rtsps?|mms|udp|rtp):/i;
    // What only ever follows a playlist or manifest inside an MSE session: fMP4 /
    // CMAF / WebM segments (an .mp4 or .webm file itself plays from the element's src).
    var SEGMENT_RE = /\.(m4s|m4v|m4a|m4f|cmfv|cmfa|cmft|mp4|webm)(\?|#|$)/i;

    function remember(set, url) {
        set.delete(url);
        set.add(url);
        if (set.size > 300) set.delete(set.values().next().value);
    }

    /**
     * Records a request the page made. `authoritative`: the media element's own
     * http(s) source, which is the stream by definition.
     */
    function noteMediaUrl(url, title, authoritative) {
        if (!url || typeof url !== 'string') return;
        if (/^blob:|^data:/i.test(url)) return;
        var absolute;
        var trimmed = url.trim();
        if (STREAM_SCHEME_RE.test(trimmed) && !/^https?:/i.test(trimmed)) {
            absolute = trimmed; // as written: URL() would drop the '@' of udp://@239.0.0.1:1234
        } else {
            try {
                absolute = new URL(url, location.href).href;
            } catch (e) {
                return;
            }
        }
        if (!STREAM_SCHEME_RE.test(absolute)) return;
        if (/^https?:/i.test(absolute) && absolute.indexOf(location.origin) === 0) return; // our own files/API
        if (!authoritative && (NOT_STREAM_RE.test(absolute) || NOT_STREAM_HOST_RE.test(absolute))) return;
        var recognised = MEDIA_URL_RE.test(absolute);
        if (authoritative) {
            session = null; // a native source replaces any MediaSource session
            prevSession = null;
            setStream(absolute, title);
            return;
        }
        if (!session) {
            if (recognised) setStream(absolute, title); // no MSE engine attached: latest wins
            return;
        }
        if (session.pinned) {
            if (recognised) remember(session.seen, absolute);
            return; // a segment, a variant or a refresh of the current stream
        }
        // First request of the session. An engine that re-attached for the same
        // stream (hls.js recoverMediaError, a shaka MediaSource reset) asks for a
        // variant or a segment it already fetched: keep the stream it had.
        if (prevSession && prevSession.pin && prevSession.seen.has(absolute)) {
            session.pinned = true;
            session.seen = prevSession.seen;
            remember(session.seen, absolute);
            setStream(prevSession.pin, null);
            return;
        }
        // A segment never starts a stream: wait for the playlist, manifest or raw stream.
        if (SEGMENT_RE.test(absolute)) return;
        // Anything else is the source the engine was given, whatever its shape
        // (extension-less or .php streams included).
        session.pinned = true;
        remember(session.seen, absolute);
        setStream(absolute, title);
    }

    function setStream(url, title) {
        lastMediaUrl = url;
        if (title) lastMediaTitle = title;
    }

    function isMediaSource(obj) {
        return !!obj && ((typeof MediaSource !== 'undefined' && obj instanceof MediaSource) ||
            (typeof ManagedMediaSource !== 'undefined' && obj instanceof ManagedMediaSource));
    }

    /**
     * Every MSE engine the app uses (hls.js, video.js VHS, shaka, mpegts.js)
     * attaches a new MediaSource through URL.createObjectURL before it requests
     * the source it was given: the playlist, the DASH manifest or the raw TS
     * stream. That first request is what an external player needs; the requests
     * after it are variants, segments and refreshes. Until the new session's
     * first request, the previous stream stays available (an engine recovering
     * from an error re-attaches without asking for its source again). The
     * session ends when its MediaSource closes, i.e. when the engine detaches
     * it from the element. Revoking the object URL means nothing: shaka does
     * that as soon as the source opens, while it plays. Installed before the
     * bundle runs: shaka keeps the createObjectURL it finds when its module
     * is evaluated.
     */
    function installMediaSourceTracking() {
        var urlApi = window.URL;
        if (!urlApi || typeof urlApi.createObjectURL !== 'function') return;
        var create = urlApi.createObjectURL;
        urlApi.createObjectURL = function (obj) {
            var objectUrl = create.apply(urlApi, arguments);
            try {
                if (isMediaSource(obj)) {
                    endSession();
                    var current = session = { pinned: false, seen: new Set() };
                    obj.addEventListener('sourceclose', function () {
                        if (session === current) endSession();
                    });
                }
            } catch (e) {
                /* ignore */
            }
            return objectUrl;
        };
    }

    /** Closes the current session, keeping its stream for a recovery match. */
    function endSession() {
        if (session && session.pinned) prevSession = { pin: lastMediaUrl, seen: session.seen };
        session = null;
    }

    /** A copied stream URL: the user's pick, unless an engine is playing a stream it already has. */
    function noteCopiedUrl(url) {
        if (session && session.pinned) return; // e.g. a catch-up URL copied while live TV plays
        lastMediaUrl = url;
        if (session) {
            session.pinned = true;
            remember(session.seen, url);
        }
    }

    function installNetworkTracking() {
        installMediaSourceTracking();
        var open = XMLHttpRequest.prototype.open;
        var send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            try {
                this.__tvGetUrl = String(method).toUpperCase() === 'GET' ? String(url) : null;
            } catch (e) {
                /* ignore */
            }
            return open.apply(this, arguments);
        };
        // The URL is noted at send(), once the response type is known: HLS/DASH
        // engines (hls.js, video.js VHS) request playlists as text and media
        // segments as arraybuffer, and a segment is not "the stream" an external
        // player should get. (mpegts.js streams raw TS through fetch, below.)
        XMLHttpRequest.prototype.send = function () {
            try {
                var url = this.__tvGetUrl;
                var type = this.responseType;
                if (url && type !== 'arraybuffer' && type !== 'blob' && type !== 'json' && type !== 'document') noteMediaUrl(url);
            } catch (e) {
                /* ignore */
            }
            return send.apply(this, arguments);
        };
        if (window.fetch) {
            var fetchFn = window.fetch;
            window.fetch = function (input, init) {
                try {
                    var url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
                    if (!init || !init.method || String(init.method).toUpperCase() === 'GET') noteMediaUrl(url);
                } catch (e) {
                    /* ignore */
                }
                return fetchFn.apply(this, arguments);
            };
        }
        document.addEventListener('play', function (e) {
            var t = e.target;
            if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) {
                currentVideo = t;
                noteMediaUrl(t.currentSrc || t.getAttribute('src'), null, true);
                lastMediaTitle = document.title;
            }
        }, true);
        var promptedFor = null, promptedRoot = null;
        /** One prompt per load attempt of a URL (the error event and the vjs-error mutation form one attempt). */
        function armPrompt(url, root) {
            if (url === promptedFor && root === promptedRoot) return false;
            promptedFor = url;
            promptedRoot = root;
            return true;
        }
        document.addEventListener('error', function (e) {
            var t = e.target;
            if (!t || !(t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) return;
            // Let the player settle (video.js reports its own error afterwards).
            setTimeout(function () {
                var url = api.currentStreamUrl();
                var code = (t.error && t.error.code) || (hasPlayerError(t) ? 4 : 0);
                // 1 = aborted, 2 = network: the connection failed, not the format; an external
                // player would fail the same way.
                if (!url || code < 3 || !armPrompt(url, t.closest ? t.closest('.video-js') : null)) return;
                lastMediaTitle = document.title;
                native('onPlaybackError', url, lastMediaTitle || '', String(code));
            }, 400);
        }, true);
        // The screen stays on only while something plays (the shell holds no wake lock otherwise).
        ['playing', 'pause', 'ended', 'emptied'].forEach(function (type) {
            document.addEventListener(type, function (e) {
                var t = e.target;
                if (!t || !(t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) return;
                if (type === 'playing' && !t.__tvKeepWatch) {
                    // Leaving a player removes its element before it pauses or empties, and the
                    // events of a detached element never reach the document: listen on it too.
                    t.__tvKeepWatch = true;
                    ['pause', 'ended', 'emptied'].forEach(function (other) {
                        t.addEventListener(other, function () { syncKeepScreenOn(false); });
                    });
                }
                syncKeepScreenOn(type === 'playing');
            }, true);
        });
        // video.js never sets the <video> src when no tech accepts the source
        // (raw .ts streams): it flags its root with `vjs-error` instead.
        var vjsObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var el = mutations[i].target;
                if (el.nodeType !== 1 || !el.classList || !el.classList.contains('video-js') || !el.classList.contains('vjs-error')) continue;
                // No error-code filter here: video.js reports a manifest the page may not read
                // (no CORS headers, the common case on a TV) as a network error, and an external
                // player, which has no CORS, is exactly what plays it.
                var url = videoJsSource();
                if (!url || !armPrompt(url, el)) continue;
                lastMediaTitle = document.title;
                native('onPlaybackError', url, lastMediaTitle || '', '4');
            }
        });
        vjsObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
        document.addEventListener('loadstart', function (e) {
            var t = e.target;
            if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) {
                currentVideo = t;
                noteMediaUrl(t.currentSrc || t.getAttribute('src'), null, true);
                promptedFor = null; // a new load attempt may prompt once more
                promptedRoot = null;
            }
        }, true);
    }

    /** "Copy stream URL" is the app's documented fallback for streams the
     *  browser cannot play — on a TV that becomes "open in an external player". */
    function installClipboardHook() {
        var clip = navigator.clipboard;
        var original = clip && typeof clip.writeText === 'function' ? clip.writeText.bind(clip) : null;
        var writeText = function (text) {
            try {
                if (typeof text === 'string' && /^(https?|rtsp|rtmp|udp|rtp|mms):\/\//i.test(text.trim())) {
                    noteCopiedUrl(text.trim());
                    native('onUrlCopied', text.trim(), lastMediaTitle || document.title || '');
                }
            } catch (e) {
                /* ignore */
            }
            if (original) return original(text).catch(function () { /* clipboard may be unavailable on TV */ });
            return Promise.resolve();
        };
        try {
            if (clip) {
                Object.defineProperty(clip, 'writeText', { value: writeText, configurable: true });
            } else {
                Object.defineProperty(navigator, 'clipboard', { value: { writeText: writeText, readText: function () { return Promise.resolve(''); } }, configurable: true });
            }
        } catch (e) {
            log('clipboard hook failed: ' + e);
        }
        // Angular CDK's clipboard copies through a hidden textarea and
        // document.execCommand('copy'): that path raises a `copy` event.
        document.addEventListener('copy', function (e) {
            try {
                var t = e.target;
                var text = (t && typeof t.value === 'string' && t.value) || (window.getSelection ? window.getSelection().toString() : '');
                text = (text || '').trim();
                if (/^(https?|rtsp|rtmp|udp|rtp|mms):\/\/\S+$/i.test(text)) {
                    noteCopiedUrl(text);
                    native('onUrlCopied', text, lastMediaTitle || document.title || '');
                }
            } catch (err) {
                /* ignore */
            }
        }, true);
    }

    // ------------------------------------------------------- navigation
    /** True when the previous history entry belongs to this document (the test the
     *  workspace header uses); navDepth is the fallback without the Navigation API. */
    function canGoBackInApp() {
        var nav = window.navigation;
        if (nav && nav.currentEntry && typeof nav.entries === 'function') {
            var index = nav.currentEntry.index;
            var prev = index > 0 ? nav.entries()[index - 1] : null;
            return !!(prev && prev.sameDocument);
        }
        return navDepth > 0;
    }

    function installHistoryTracking() {
        var pushState = history.pushState;
        history.pushState = function () {
            navDepth += 1;
            var result = pushState.apply(this, arguments);
            scheduleRefocus();
            return result;
        };
        window.addEventListener('popstate', function () {
            if (navDepth > 0) navDepth -= 1;
            scheduleRefocus();
        });
    }

    var refocusTimer = null;
    function scheduleRefocus() {
        if (refocusTimer) clearTimeout(refocusTimer);
        refocusTimer = setTimeout(function () {
            refocusTimer = null;
            var active = document.activeElement;
            if (!active || active === document.body || !active.isConnected || !isVisible(active)) {
                focusFirst();
            } else if (!active.classList.contains(FOCUS_CLASS)) {
                active.classList.add(FOCUS_CLASS);
                lastRect = rectOf(active);
            }
        }, 350);
    }

    function installFocusMirror() {
        // Keep the ring on whatever the app focuses itself (dialog autofocus...).
        document.addEventListener('focusin', function (e) {
            var t = e.target;
            if (!t || t === document.body || t.nodeType !== 1) return;
            var previous = document.querySelectorAll('.' + FOCUS_CLASS);
            for (var i = 0; i < previous.length; i++) if (previous[i] !== t) previous[i].classList.remove(FOCUS_CLASS);
            t.classList.add(FOCUS_CLASS);
            lastRect = rectOf(t);
        }, true);
        // When the focused element disappears (virtual scroll recycling, route
        // change), re-establish focus near the previous position.
        var observer = new MutationObserver(function () {
            var active = document.activeElement;
            if (!active || active === document.body) scheduleRefocus();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    // ------------------------------------------------------------- init
    function init() {
        document.documentElement.classList.add('tv-shell');
        document.body.classList.add('tv-shell');
        installStyle();
        installNetworkTracking();
        installClipboardHook();
        installHistoryTracking();
        installFocusMirror();
        document.addEventListener('keydown', onKeyDown, true);
        // Keyups arrive in queue order: a keydown after one is a new press, however late it runs.
        document.addEventListener('keyup', function (e) {
            if (DIR[e.key]) heldArrow = null;
        }, true);
        window.addEventListener('blur', function () {
            heldArrow = null;
        });
        // Initial focus once Angular has rendered something.
        var attempts = 0;
        var timer = setInterval(function () {
            attempts += 1;
            var active = document.activeElement;
            if ((active && active !== document.body) || focusFirst() || attempts > 60) clearInterval(timer);
        }, 250);
        log('ready (' + (isAndroid ? 'android' : 'browser emulation: F9=Back F10=Menu F8=Play/Pause F7=External') + ')');
        // Report ready only once Angular has rendered (main.ts removes
        // #initial-splash after the first paint). A bundle this engine cannot
        // parse never gets there, so the shell's watchdog shows the diagnostics
        // instead of this call hiding the splash. No cap: the shell is the cap.
        var readyTimer = setInterval(function () {
            var root = document.querySelector('app-root');
            var rendered = !document.getElementById('initial-splash') && (!root || root.childElementCount > 0);
            if (!rendered) return;
            clearInterval(readyTimer);
            native('onReady', location.href);
            // The shell kept the screen on through the splash and stops at onReady: a player
            // that started before (a restored route) says so right after.
            keepScreenOn = anyMediaPlaying();
            if (keepScreenOn) native('setKeepScreenOn', true);
        }, 250);
    }

    window.__tvShell = api;
    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
})();
