/**
 * Playlist files handed to the app by the operating system.
 *
 * Three entry points converge here:
 *  - a first launch with a path argument (`iptvnator playlist.m3u`, which is
 *    also what the Windows file association does; the Linux one passes a
 *    `file://` URI instead),
 *  - a second launch while the app is already running, whose argv the
 *    single-instance guard forwards,
 *  - macOS, which never puts the path in argv and emits `open-file` instead.
 *
 * All three can fire before the renderer exists, so requests are queued in the
 * main process until a renderer announces itself. A request leaves the queue
 * only once that renderer *acknowledges* it: `webContents.send()` returns
 * before the listener runs, and a reload or a dead render process keeps the
 * `WebContents` alive, so a successful push is not proof of receipt. Anything
 * unacknowledged is replayed to the next renderer that announces itself.
 */

import { basename, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PlaylistOpenRequest {
    readonly fileName: string;
    readonly filePath: string;
    /** Identifies the request so the renderer can acknowledge it. */
    readonly requestId: string;
}

/** Returns `false` when the target is gone and the request must stay queued. */
export type PlaylistOpenRequestDelivery = (
    request: PlaylistOpenRequest
) => boolean;

const PLAYLIST_FILE_PATTERN = /\.(m3u|m3u8)$/i;

let requestCounter = 0;

function nextRequestId(): string {
    requestCounter += 1;
    return `playlist-open-${requestCounter}`;
}

export function isPlaylistFilePath(candidate: string): boolean {
    return PLAYLIST_FILE_PATTERN.test(candidate.trim());
}

/**
 * Linux desktop entries end in `%U`, so file managers hand over a
 * percent-encoded `file:///…` URI rather than a path — Electron Builder appends
 * that exec code unconditionally unless `linux.executableArgs` already carries
 * one, and putting one there would also pass it to the app as a real argument.
 * Every other source (macOS `open-file`, the Windows association command, a
 * shell argument) supplies a plain path, which is returned untouched.
 */
function toLocalPath(candidate: string): string | null {
    if (!/^file:\/\//i.test(candidate)) {
        return candidate;
    }

    try {
        // Rejects a URI naming another host, whose path is not ours to read.
        return fileURLToPath(candidate);
    } catch {
        return null;
    }
}

/**
 * Normalizes an OS-supplied path or `file://` URI into an open request, or
 * returns `null` when it is not a playlist file. Relative paths are resolved
 * against the working
 * directory of the process that supplied them — for a forwarded second launch
 * that is *not* this process' cwd.
 */
export function createPlaylistOpenRequest(
    filePath: string,
    workingDirectory?: string
): PlaylistOpenRequest | null {
    const candidate = filePath?.trim();
    // Decoded before the extension check so a percent-encoded name still ends
    // in a recognizable `.m3u`.
    const localPath = candidate ? toLocalPath(candidate) : null;

    if (!localPath || !isPlaylistFilePath(localPath)) {
        return null;
    }

    const absolutePath = isAbsolute(localPath)
        ? localPath
        : resolve(workingDirectory?.trim() || process.cwd(), localPath);

    return {
        fileName: basename(absolutePath),
        filePath: absolutePath,
        requestId: nextRequestId(),
    };
}

/**
 * Picks every playlist path out of a process argv, in the order given.
 *
 * `argv[0]` is the executable and is always skipped; so is every switch, since
 * Electron and Chromium add plenty of them (`--remote-debugging-port=9222`,
 * `--ozone-platform=x11`, …) and a switch value is never the user's file.
 * In development the renderer entry (`main.js`) sits in argv too, but it is
 * not a playlist file so the extension check filters it out.
 *
 * Selecting several playlists in a Linux file manager delivers them as one
 * launch with one argument each, because the desktop entry ends in `%U` — the
 * plural exec code — so stopping at the first match would silently drop the
 * rest of the selection.
 */
export function extractPlaylistOpenRequestsFromArgv(
    argv: readonly string[],
    workingDirectory?: string
): PlaylistOpenRequest[] {
    const requests: PlaylistOpenRequest[] = [];

    for (const argument of argv.slice(1)) {
        if (typeof argument !== 'string' || argument.startsWith('-')) {
            continue;
        }

        const request = createPlaylistOpenRequest(argument, workingDirectory);

        if (request) {
            requests.push(request);
        }
    }

    return requests;
}

export class PlaylistOpenRequestQueue {
    private delivery: PlaylistOpenRequestDelivery | null = null;
    private flushing = false;
    private pending: PlaylistOpenRequest[] = [];
    /** Pushed, waiting for the renderer to confirm it got them. */
    private awaitingAck: PlaylistOpenRequest[] = [];

    enqueue(request: PlaylistOpenRequest | null | undefined): void {
        if (!request) {
            return;
        }

        this.pending.push(request);
        this.flush();
    }

    /**
     * Queues a whole selection at once. One flush for the batch, so a delivery
     * that fails partway leaves the untouched remainder in arrival order.
     */
    enqueueAll(requests: readonly (PlaylistOpenRequest | null | undefined)[]): void {
        for (const request of requests) {
            if (request) {
                this.pending.push(request);
            }
        }

        this.flush();
    }

    /** Queued requests, in arrival order. Exposed for assertions. */
    get pendingRequests(): readonly PlaylistOpenRequest[] {
        return this.pending;
    }

    /** Delivered but not yet acknowledged. Exposed for assertions. */
    get unacknowledgedRequests(): readonly PlaylistOpenRequest[] {
        return this.awaitingAck;
    }

    /**
     * Drops a request for good. `webContents.send()` resolves nothing and
     * returns before the renderer has run its listener, so a push that merely
     * *left* the main process is not proof of receipt — only this is.
     */
    acknowledge(requestId: string): void {
        this.awaitingAck = this.awaitingAck.filter(
            (request) => request.requestId !== requestId
        );
    }

    /**
     * Points the queue at a renderer. Anything an earlier renderer never
     * acknowledged goes back to the front of the queue: a reload or a crashed
     * render process leaves the `WebContents` alive, so delivery cannot detect
     * it and the request would otherwise be gone.
     */
    setDelivery(delivery: PlaylistOpenRequestDelivery | null): void {
        this.pending = [...this.awaitingAck, ...this.pending];
        this.awaitingAck = [];
        this.delivery = delivery;
        this.flush();
    }

    private flush(): void {
        if (this.flushing) {
            return;
        }

        this.flushing = true;
        try {
            while (this.delivery && this.pending.length > 0) {
                const next = this.pending[0];

                if (!this.delivery(next)) {
                    // The renderer is gone. Keep everything queued for the
                    // next one instead of pushing into a dead window.
                    this.delivery = null;
                    return;
                }

                this.pending.shift();
                this.awaitingAck.push(next);
            }
        } finally {
            this.flushing = false;
        }
    }
}

export const playlistOpenRequests = new PlaylistOpenRequestQueue();
