import { SourceHealthEvidenceService } from './source-health-evidence.service';
import { Injectable, inject } from '@angular/core';
import {
    isPlaylistRefreshCancelledResult,
    Playlist,
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
} from '@iptvnator/shared/interfaces';

export interface PlaylistRefreshOptions {
    onEvent?: (event: PlaylistRefreshEvent) => void;
}

@Injectable({
    providedIn: 'root',
})
export class PlaylistRefreshService {
    private readonly healthEvidence = inject(SourceHealthEvidenceService, {
        optional: true,
    });
    async refreshPlaylist(
        payload: PlaylistRefreshPayload,
        options?: PlaylistRefreshOptions
    ): Promise<Playlist> {
        if (!window.electron?.refreshPlaylist) {
            throw new Error('Playlist refresh is only available in Electron');
        }

        const unsubscribe = window.electron.onPlaylistRefreshEvent?.(
            (event) => {
                if (event.operationId !== payload.operationId) {
                    return;
                }

                options?.onEvent?.(event);
            }
        );

        try {
            const result = await window.electron.refreshPlaylist(payload);
            if (isPlaylistRefreshCancelledResult(result)) {
                const error = new Error(
                    `Playlist refresh "${result.operationId}" was cancelled`
                );
                error.name = 'AbortError';
                throw error;
            }
            this.healthEvidence?.results.next({
                playlist: result,
                result: {
                    state: 'active',
                    reason: 'available',
                    confirmedInactive: false,
                },
            });
            return result;
        } finally {
            unsubscribe?.();
        }
    }

    async cancelRefresh(operationId: string): Promise<boolean> {
        if (!window.electron?.cancelPlaylistRefresh || !operationId) {
            return false;
        }

        try {
            const result =
                await window.electron.cancelPlaylistRefresh(operationId);
            return result.success;
        } catch (error) {
            console.error('Failed to cancel playlist refresh:', error);
            return false;
        }
    }
}
