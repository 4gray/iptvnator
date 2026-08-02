import { Injectable } from '@angular/core';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

function getHeaderValue(
    headers: ResolvedPortalPlayback['headers'] | undefined,
    name: string
): string | undefined {
    if (!headers) {
        return undefined;
    }

    const matchingKey = Object.keys(headers).find(
        (key) => key.toLowerCase() === name.toLowerCase()
    );
    return matchingKey ? headers[matchingKey] : undefined;
}

/**
 * Single owner of the scoped Electron request-header override for built-in
 * playback. There is exactly one scoped override slot in the main process, so
 * every surface that plays a stream inline goes through this service:
 * `WebPlayerViewComponent` for the web video players, and the Stalker live
 * layout for the dedicated radio audio player, which never mounts a
 * `WebPlayerViewComponent` at all.
 *
 * `apply()` extracts the full header set from the resolved playback —
 * including the portal Cookie/Authorization that auth-gated streams require —
 * and hands it to the main process scoped to the stream's URL. A playback
 * without custom headers deliberately clears the previous scoped override so
 * stale headers never leak onto the next stream. `clear()` releases the slot
 * only while the caller's stream still owns it, so a consumer being destroyed
 * cannot wipe the override a newer consumer just configured.
 */
@Injectable({ providedIn: 'root' })
export class ElectronStreamHeadersService {
    /** Guards against a superseded apply resolving its header IPC late. */
    private syncSequence = 0;
    /** Stream URL the currently configured override belongs to. */
    private currentScopeUrl: string | null = null;

    /**
     * Configures the scoped override for this playback. Resolves `true` when
     * this apply is still the newest one at the time the main process
     * acknowledged it — callers must only hand the source to a player on
     * `true`, so the first media request already carries the headers. Returns
     * null when there is no Electron bridge (PWA), where sources apply
     * synchronously and no override exists.
     */
    apply(playback: ResolvedPortalPlayback): Promise<boolean> | null {
        // Feature-detect the bridge method rather than the bridge object:
        // partial bridges (tests, older preloads) must behave like the PWA
        // instead of throwing inside a playback flow.
        if (typeof window.electron?.setUserAgent !== 'function') {
            return null;
        }

        const sequence = ++this.syncSequence;
        const userAgent =
            playback.userAgent ??
            getHeaderValue(playback.headers, 'User-Agent');
        const referer =
            playback.referer ?? getHeaderValue(playback.headers, 'Referer');
        const cookie = getHeaderValue(playback.headers, 'Cookie');
        const authorization = getHeaderValue(playback.headers, 'Authorization');

        this.currentScopeUrl = playback.streamUrl;
        return window.electron
            .setUserAgent(
                userAgent,
                referer,
                playback.streamUrl,
                cookie || authorization ? { authorization, cookie } : undefined
            )
            .catch((error: unknown) => {
                console.warn(
                    '[ElectronStreamHeaders] Failed to configure request headers:',
                    error
                );
                return true;
            })
            .then(() => sequence === this.syncSequence);
    }

    /**
     * Clears the scoped override — portal credentials must not outlive the
     * playback session that needed them. No-ops when another stream has taken
     * ownership of the slot since, and always in the PWA.
     */
    clear(streamUrl: string | null): void {
        if (
            typeof window.electron?.setUserAgent !== 'function' ||
            streamUrl === null ||
            this.currentScopeUrl !== streamUrl
        ) {
            return;
        }

        this.syncSequence += 1;
        this.currentScopeUrl = null;
        void window.electron
            .setUserAgent(undefined, undefined, streamUrl)
            .catch(() => undefined);
    }
}
