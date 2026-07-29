import { Injectable } from '@angular/core';
import type { VodSourcePin } from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';

/**
 * Persistence for the per-movie pinned source ("play this film from here").
 *
 * Electron-only, like the discovery that feeds it: without cross-playlist
 * matching there is nothing to pin between. In the PWA every call is a no-op
 * and `isAvailable` is false, so the UI hides the affordance rather than
 * offering a button that silently forgets.
 */
@Injectable({ providedIn: 'root' })
export class VodSourcePinService {
    get isAvailable(): boolean {
        return (
            typeof window !== 'undefined' &&
            typeof window.electron?.dbGetVodSourcePin === 'function'
        );
    }

    /**
     * @param matchKeys every key this movie may be stored under, MOST TRUSTED
     * FIRST. A film pinned before TMDB enrichment landed is keyed by title and
     * prefers a `tmdb:` key afterwards; passing both means the id arriving
     * later does not orphan the pin.
     */
    async get(matchKeys: string[]): Promise<VodSourcePin | null> {
        if (!this.isAvailable || matchKeys.length === 0) {
            return null;
        }

        try {
            return await window.electron.dbGetVodSourcePin(matchKeys);
        } catch (error) {
            console.warn(
                'Reading the pinned VOD source failed:',
                redactSensitiveData(error)
            );
            return null;
        }
    }

    /**
     * Drop every pin pointing at this playlist, in one statement.
     *
     * `clear()` caps its key list, so clearing a playlist through it would
     * silently leave the surplus behind while reporting success.
     */
    async clearForPlaylist(playlistId: string): Promise<boolean> {
        if (!this.isAvailable || !playlistId) {
            return false;
        }

        try {
            const result =
                await window.electron.dbClearVodSourcePinsForPlaylist(
                    playlistId
                );
            return result?.success === true;
        } catch (error) {
            console.warn(
                'Clearing pinned VOD sources failed:',
                redactSensitiveData(error)
            );
            return false;
        }
    }

    /**
     * Every pin pointing at this playlist, empty when there are none OR when
     * the read failed. Only for callers that treat both the same way.
     */
    async listForPlaylist(playlistId: string): Promise<VodSourcePin[]> {
        try {
            return await this.readForPlaylist(playlistId);
        } catch (error) {
            console.warn(
                'Listing pinned VOD sources failed:',
                redactSensitiveData(error)
            );
            return [];
        }
    }

    /**
     * As above, but a failed read THROWS instead of reading as "none".
     *
     * Backup needs this distinction and nothing else does. An export writes
     * `sourcePins` as the authoritative set for the playlist, and restore
     * clears whatever is there before applying it — so a read that failed and
     * returned `[]` produces a backup that looks complete and silently wipes
     * every pin the user had. Losing the preferences is bad; losing them via a
     * file created to protect them is worse.
     */
    async listForPlaylistOrThrow(playlistId: string): Promise<VodSourcePin[]> {
        return this.readForPlaylist(playlistId);
    }

    private async readForPlaylist(playlistId: string): Promise<VodSourcePin[]> {
        if (!this.isAvailable || !playlistId) {
            return [];
        }

        return (await window.electron.dbListVodSourcePins(playlistId)) ?? [];
    }

    /**
     * Store the pin, also under `aliasKeys`, retiring `retireKeys` — all in
     * the same transaction, because a half-applied change has no honest
     * outcome to report.
     *
     * @param aliasKeys further keys naming exactly this film. A movie's
     * identity grows as enrichment lands, and a pin recorded only under the
     * richest key is invisible to the next reopen that has not been enriched.
     */
    async set(
        pin: VodSourcePin,
        retireKeys: string[] = [],
        aliasKeys: string[] = []
    ): Promise<boolean> {
        if (!this.isAvailable) {
            return false;
        }

        try {
            const result = await window.electron.dbSetVodSourcePin(
                pin,
                retireKeys,
                aliasKeys
            );
            return result?.success === true;
        } catch (error) {
            console.warn(
                'Pinning the VOD source failed:',
                redactSensitiveData(error)
            );
            return false;
        }
    }

    /**
     * Make this playlist's pins exactly `pins`, in one transaction.
     *
     * Restore needs the clear and the writes to be indivisible. Done in steps,
     * a write that fails partway leaves the user's previous pins already gone
     * and only part of the archive applied — a state belonging to neither, and
     * reported as a failure the user cannot act on.
     */
    async replaceForPlaylist(
        playlistId: string,
        pins: VodSourcePin[]
    ): Promise<boolean> {
        if (!this.isAvailable || !playlistId) {
            return false;
        }

        try {
            const result = await window.electron.dbReplaceVodSourcePins(
                playlistId,
                pins
            );
            return result?.success === true;
        } catch (error) {
            console.warn(
                'Replacing pinned VOD sources failed:',
                redactSensitiveData(error)
            );
            return false;
        }
    }

    /** Clears the pin under every alias, so unpinning cannot be undone by a
     * stale row stored under the other key form. */
    async clear(matchKeys: string[]): Promise<boolean> {
        if (!this.isAvailable || matchKeys.length === 0) {
            return false;
        }

        try {
            const result = await window.electron.dbClearVodSourcePin(matchKeys);
            return result?.success === true;
        } catch (error) {
            console.warn(
                'Unpinning the VOD source failed:',
                redactSensitiveData(error)
            );
            return false;
        }
    }
}
