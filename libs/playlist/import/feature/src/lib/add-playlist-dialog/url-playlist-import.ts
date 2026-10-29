import { DestroyRef, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DataService } from '@iptvnator/services';

export interface UrlPlaylistDraft {
    playlistUrl: string;
    playlistName?: string;
    userAgent?: string;
}

/** The open dialog owns acquisition; abandoned responses never reach the store. */
export function createUrlPlaylistImport() {
    const data = inject(DataService);
    const store = inject(Store);
    const destroyRef = inject(DestroyRef);
    const pending = signal(false);
    const errorKey = signal<string | null>(null);
    let generation = 0;
    const cancel = () => {
        generation++;
        pending.set(false);
    };
    destroyRef.onDestroy(cancel);

    async function submit(
        draft: UrlPlaylistDraft,
        completed: () => void,
        retry?: () => void
    ) {
        if (pending() || destroyRef.destroyed) return;
        const owned = ++generation;
        const current = () => owned === generation && !destroyRef.destroyed;
        pending.set(true);
        errorKey.set(null);
        try {
            const playlist = await data.fetchPlaylistDefinition(
                draft.playlistUrl.trim(),
                draft.userAgent?.trim() || undefined
            );
            if (!current()) return;
            const title = draft.playlistName?.trim();
            store.dispatch(
                PlaylistActions.handleAddingPlaylistByUrl({
                    isTemporary: false,
                    playlist: title
                        ? { ...playlist, title, filename: title }
                        : playlist,
                })
            );
            completed();
        } catch (error) {
            if (!current()) return;
            errorKey.set(importErrorKey(error));
            // Preserve Electron's explicit TLS-trust flow, but its delayed
            // action must still belong to this dialog and this draft.
            data.recoverPlaylistImportError?.(error, () => {
                if (current()) retry?.();
            });
        } finally {
            if (current()) pending.set(false);
        }
    }
    const clearError = () => {
        if (!pending()) {
            generation++;
            errorKey.set(null);
        }
    };
    return { pending, errorKey, submit, cancel, clearError };
}

function importErrorKey(error: unknown): string {
    const details = error as {
        status?: number;
        response?: { status?: number };
        message?: string;
    } | null;
    const status =
        details?.status ??
        details?.response?.status ??
        Number(
            (typeof details?.message === 'string' ? details.message : '').match(
                /(?:status code|HTTP Error|Status:)\s*(\d{3})/i
            )?.[1]
        );
    return `HOME.URL_UPLOAD.${
        [401, 403, 404, 413].includes(status)
            ? `ERROR_${status}`
            : 'ERROR_FETCH_FAILED'
    }`;
}
