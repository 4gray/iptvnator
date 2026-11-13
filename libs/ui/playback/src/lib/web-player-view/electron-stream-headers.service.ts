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

/** Per-owner bookkeeping of the scoped override this renderer configured. */
interface HeaderOwnerState {
    /** Guards against a superseded apply resolving its header IPC late. */
    sequence: number;
    /** Stream URL the owner's configured override belongs to. */
    scopeUrl: string | null;
}

/**
 * Renderer-side owner of the scoped Electron request-header overrides for
 * built-in playback. Every surface that plays a stream inline goes through
 * this service: `WebPlayerViewComponent` for the web video players, plus the
 * two surfaces that render `AudioPlayerComponent` for radio and therefore
 * never mount a `WebPlayerViewComponent` at all — the Stalker live layout,
 * and the unified live tab behind the Favorites / Recently Viewed collection
 * routes.
 *
 * The main process keeps one scoped override per owner. Callers that pass no
 * owner share the default one, which behaves as a single slot: there is one
 * inline player at a time, and the next stream replaces the previous
 * override. A multiview tile passes its own owner so several streams can
 * carry different headers at once.
 *
 * `apply()` extracts the full header set from the resolved playback —
 * including the portal Cookie/Authorization that auth-gated streams require —
 * and hands it to the main process scoped to the stream's URL. A playback
 * without custom headers deliberately clears the owner's previous override so
 * stale headers never leak onto the next stream. `clear()` releases the
 * override only while the caller's stream still owns it, so a consumer being
 * destroyed cannot wipe the override a newer consumer just configured.
 */
@Injectable({ providedIn: 'root' })
export class ElectronStreamHeadersService {
    private readonly defaultOwner: HeaderOwnerState = {
        sequence: 0,
        scopeUrl: null,
    };
    private readonly namedOwners = new Map<string, HeaderOwnerState>();

    /**
     * Configures the scoped override for this playback. Resolves `true` when
     * this apply is still the owner's newest one at the time the main process
     * acknowledged it — callers must only hand the source to a player on
     * `true`, so the first media request already carries the headers. Returns
     * null when there is no Electron bridge (PWA), where sources apply
     * synchronously and no override exists.
     */
    apply(
        playback: ResolvedPortalPlayback,
        owner: string | null = null
    ): Promise<boolean> | null {
        // Feature-detect the bridge method rather than the bridge object:
        // partial bridges (tests, older preloads) must behave like the PWA
        // instead of throwing inside a playback flow.
        if (typeof window.electron?.setUserAgent !== 'function') {
            return null;
        }

        const state = this.stateFor(owner);
        const sequence = ++state.sequence;
        const userAgent =
            playback.userAgent ??
            getHeaderValue(playback.headers, 'User-Agent');
        const referer =
            playback.referer ?? getHeaderValue(playback.headers, 'Referer');
        const origin =
            playback.origin ?? getHeaderValue(playback.headers, 'Origin');
        const cookie = getHeaderValue(playback.headers, 'Cookie');
        const authorization = getHeaderValue(playback.headers, 'Authorization');
        const credentials =
            cookie || authorization ? { authorization, cookie } : undefined;

        state.scopeUrl = playback.streamUrl;
        // The default owner sends exactly the arguments it always has.
        const request =
            owner === null
                ? window.electron.setUserAgent(
                      userAgent,
                      referer,
                      playback.streamUrl,
                      credentials,
                      origin
                  )
                : window.electron.setUserAgent(
                      userAgent,
                      referer,
                      playback.streamUrl,
                      credentials,
                      origin,
                      owner
                  );
        return request
            .catch((error: unknown) => {
                console.warn(
                    '[ElectronStreamHeaders] Failed to configure request headers:',
                    error
                );
                return true;
            })
            .then(
                () =>
                    this.currentState(owner) === state &&
                    sequence === state.sequence
            );
    }

    /**
     * Clears the owner's scoped override — portal credentials must not
     * outlive the playback session that needed them. No-ops when another
     * stream has taken the owner's override since, and always in the PWA.
     */
    clear(streamUrl: string | null, owner: string | null = null): void {
        const state = this.currentState(owner);
        if (
            typeof window.electron?.setUserAgent !== 'function' ||
            streamUrl === null ||
            !state ||
            state.scopeUrl !== streamUrl
        ) {
            return;
        }

        state.sequence += 1;
        state.scopeUrl = null;
        const request =
            owner === null
                ? window.electron.setUserAgent(undefined, undefined, streamUrl)
                : window.electron.setUserAgent(
                      undefined,
                      undefined,
                      streamUrl,
                      undefined,
                      undefined,
                      owner
                  );
        if (owner !== null) {
            // A tile's owner id is never reused; drop its bookkeeping.
            this.namedOwners.delete(owner);
        }
        void request.catch(() => undefined);
    }

    private currentState(owner: string | null): HeaderOwnerState | undefined {
        return owner === null ? this.defaultOwner : this.namedOwners.get(owner);
    }

    private stateFor(owner: string | null): HeaderOwnerState {
        if (owner === null) {
            return this.defaultOwner;
        }

        let state = this.namedOwners.get(owner);
        if (!state) {
            state = { sequence: 0, scopeUrl: null };
            this.namedOwners.set(owner, state);
        }
        return state;
    }
}
