import { DestroyRef, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DataService, type PlaylistImportRecovery } from '@iptvnator/services';
import {
    measureRendererPerformancePhase,
    RENDERER_PERFORMANCE_PHASE,
} from '@iptvnator/shared/logging';

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
    const errorCode = signal<string | null>(null);
    const recovery = signal<PlaylistImportRecovery | null>(null);
    let generation = 0;
    const cancel = () => {
        generation++;
        pending.set(false);
        recovery.set(null);
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
        errorCode.set(null);
        recovery.set(null);
        try {
            const playlist = await data.fetchPlaylistDefinition(
                draft.playlistUrl.trim(),
                draft.userAgent?.trim() || undefined
            );
            if (!current()) return;
            const title = draft.playlistName?.trim();
            measureRendererPerformancePhase(
                RENDERER_PERFORMANCE_PHASE.M3U_IMPORT_DISPATCH,
                () =>
                    store.dispatch(
                        PlaylistActions.handleAddingPlaylistByUrl({
                            isTemporary: false,
                            playlist: title
                                ? { ...playlist, title, filename: title }
                                : playlist,
                        })
                    )
            );
            completed();
        } catch (error) {
            if (!current()) return;
            errorKey.set(importErrorKey(error));
            errorCode.set(importErrorCode(error));
            const action = data.playlistImportRecovery?.(error, () => {
                if (current()) retry?.();
            });
            if (action) {
                errorKey.set(action.messageKey);
                recovery.set({
                    ...action,
                    run: () => {
                        if (current()) action.run();
                    },
                });
            }
        } finally {
            if (current()) pending.set(false);
        }
    }
    const clearError = () => {
        if (!pending()) {
            generation++;
            errorKey.set(null);
            errorCode.set(null);
            recovery.set(null);
        }
    };
    return {
        pending,
        errorKey,
        errorCode,
        recovery,
        submit,
        cancel,
        clearError,
    };
}

/** Only diagnostic identifiers, never provider messages or URLs. */
function importErrorCode(error: unknown): string | null {
    const details = error as {
        code?: unknown;
        error?: { code?: unknown };
    } | null;
    const code = details?.error?.code ?? details?.code;
    return typeof code === 'string' &&
        code.match(/^[A-Z][A-Z0-9_]{1,47}$/)?.[0] === code
        ? code
        : null;
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
