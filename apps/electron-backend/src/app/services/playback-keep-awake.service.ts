import { powerSaveBlocker, WebContents } from 'electron';

/**
 * Keeps the display awake while a built-in web player (HTML5/hls.js,
 * Video.js, ArtPlayer) is playing video in the renderer (issue #1095).
 *
 * Chromium is supposed to hold a video wake lock on its own, but on Linux
 * that goes through DE-dependent D-Bus inhibitors and is not reliable, so the
 * renderer reports playback activity explicitly over IPC and the main process
 * holds a single `powerSaveBlocker('prevent-display-sleep')` — the same
 * mechanism `EmbeddedMpvNativeService` already uses for embedded MPV
 * sessions. External MPV/VLC inhibit the screensaver themselves.
 *
 * The renderer's flag must not outlive the page that set it: a reload or a
 * crashed render process would otherwise pin the display awake until app
 * quit. Each activating WebContents therefore gets destroy/crash/navigation
 * listeners that withdraw its vote — a crash emits `render-process-gone`
 * while the WebContents object stays alive, so `destroyed` alone would miss
 * it when no reload follows.
 */

const activeSenders = new Set<number>();
const senderCleanups = new Map<number, () => void>();
let blockerId: number | null = null;

export function setPlaybackKeepAwake(
    sender: WebContents,
    active: boolean
): void {
    if (active) {
        if (!activeSenders.has(sender.id)) {
            activeSenders.add(sender.id);
            watchSenderLifetime(sender);
        }
    } else {
        clearSender(sender.id);
    }
    syncBlocker();
}

/** Test-only: drop all votes and release the blocker. */
export function resetPlaybackKeepAwakeForTesting(): void {
    for (const cleanup of senderCleanups.values()) {
        cleanup();
    }
    senderCleanups.clear();
    activeSenders.clear();
    syncBlocker();
}

function watchSenderLifetime(sender: WebContents): void {
    const senderId = sender.id;
    const clear = () => {
        clearSender(senderId);
        syncBlocker();
    };
    const onNavigation = (
        event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>
    ) => {
        // A main-frame load replaces the page that voted; same-document
        // navigations (Angular routing) keep the player alive.
        if (event.isMainFrame && !event.isSameDocument) {
            clear();
        }
    };
    sender.on('destroyed', clear);
    sender.on('render-process-gone', clear);
    sender.on('did-start-navigation', onNavigation);
    senderCleanups.set(senderId, () => {
        sender.off('destroyed', clear);
        sender.off('render-process-gone', clear);
        sender.off('did-start-navigation', onNavigation);
    });
}

function clearSender(senderId: number): void {
    if (!activeSenders.delete(senderId)) {
        return;
    }
    const cleanup = senderCleanups.get(senderId);
    senderCleanups.delete(senderId);
    cleanup?.();
}

function syncBlocker(): void {
    const shouldBlock = activeSenders.size > 0;

    if (shouldBlock && blockerId === null) {
        try {
            blockerId = powerSaveBlocker.start('prevent-display-sleep');
        } catch {
            blockerId = null;
        }
        return;
    }

    if (!shouldBlock && blockerId !== null) {
        const idToStop = blockerId;
        blockerId = null;
        try {
            if (powerSaveBlocker.isStarted(idToStop)) {
                powerSaveBlocker.stop(idToStop);
            }
        } catch {
            // ignore — the assertion dies with the process anyway
        }
    }
}
