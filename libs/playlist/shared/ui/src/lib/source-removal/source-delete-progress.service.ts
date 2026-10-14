import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { DatabaseService, DbOperationEvent } from '@iptvnator/services';

interface DeleteOperation {
    operationId?: string;
    phase?: string;
    current?: number;
    total?: number;
}

const PHASE_KEYS: Record<string, string> = {
    'deleting-favorites': 'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_FAVORITES',
    'deleting-recently-viewed': 'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_RECENT',
    'deleting-playback-positions':
        'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_PROGRESS',
    'deleting-downloads': 'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_DOWNLOADS',
    'deleting-content': 'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_CONTENT',
    'deleting-categories': 'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_CATEGORIES',
    'deleting-playlist': 'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_PLAYLIST',
};

/**
 * Progress of a committed delete that reports it: an Xtream catalog in the
 * desktop database can take a while, so its row comes back as "Removing…"
 * with progress and a Cancel action that keeps the source.
 */
@Injectable({ providedIn: 'root' })
export class SourceDeleteProgressService {
    private readonly database = inject(DatabaseService);
    private readonly translate = inject(TranslateService);
    private readonly operations = signal<ReadonlyMap<string, DeleteOperation>>(
        new Map()
    );
    private readonly cancelled = new Set<string>();

    isDeleting(id: string): boolean {
        return this.operations().has(id);
    }

    message(id: string): string {
        const operation = this.operations().get(id);
        if (!operation) {
            return '';
        }
        return this.translate.instant(
            PHASE_KEYS[operation.phase ?? ''] ??
                'HOME.PLAYLISTS.REMOVE_DIALOG.IN_PROGRESS'
        );
    }

    progress(id: string): number | null {
        const operation = this.operations().get(id);
        if (!operation?.total || operation.current == null) {
            return null;
        }
        return Math.min(
            100,
            Math.round((operation.current / operation.total) * 100)
        );
    }

    canCancel(id: string): boolean {
        return !!this.operations().get(id)?.operationId;
    }

    async cancel(id: string): Promise<void> {
        const operationId = this.operations().get(id)?.operationId;
        if (operationId) {
            this.cancelled.add(id);
            await this.database.cancelOperation(operationId);
        }
    }

    /** True once, after a cancelled delete: the caller skips its error. */
    takeCancelled(id: string): boolean {
        return this.cancelled.delete(id);
    }

    /**
     * Follows a running delete. A terminal event ends what Cancel can stop,
     * but the row stays busy: the delete still cleans up (parental lock,
     * stored state) before its source leaves the store, so the caller clears
     * it once the whole delete has settled.
     */
    track(id: string, event: DbOperationEvent): void {
        const terminal = ['completed', 'cancelled', 'error'].includes(
            event.status
        );
        this.operations.update((current) =>
            new Map(current).set(
                id,
                terminal
                    ? { ...current.get(id), operationId: undefined }
                    : {
                          operationId: event.operationId,
                          phase: event.phase,
                          current: event.current,
                          total: event.total,
                      }
            )
        );
    }

    clear(id: string): void {
        if (!this.operations().has(id)) {
            return;
        }
        this.operations.update((current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
        });
    }
}
