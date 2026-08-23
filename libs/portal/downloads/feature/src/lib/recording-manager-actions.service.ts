import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { type RecordingItem, RecordingsService } from '@iptvnator/services';
import { DialogService } from '@iptvnator/ui/components';
import type {
    RecordingActionResult,
    RecordingItemAction,
} from './recording-actions';

interface RecordingOperationResult {
    readonly success: boolean;
    readonly error?: string;
}

/** Mirror of DownloadManagerActionsService for recording rows. */
@Injectable()
export class RecordingManagerActionsService {
    private readonly recordings = inject(RecordingsService);
    private readonly dialogs = inject(DialogService);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);

    readonly pendingIds = signal<ReadonlySet<number>>(new Set());

    async run(action: RecordingItemAction): Promise<RecordingActionResult> {
        const { item, type } = action;
        if (this.pendingIds().has(item.id)) {
            return 'ignored';
        }
        switch (type) {
            case 'remove':
                this.confirmRemove(item);
                return 'ignored';
            case 'stop':
                return this.withPending(item.id, () =>
                    this.recordings.stopRecording(item.id)
                );
            case 'play':
            case 'reveal':
                return this.runFileAction(type, item);
            case 'open-detail':
                return 'ignored';
        }
    }

    showActionError(error?: string): void {
        const base = this.translate.instant('DOWNLOADS.ACTION_FAILED');
        this.snackBar.open(error ? `${base}: ${error}` : base, undefined, {
            duration: 4000,
            horizontalPosition: 'start',
        });
    }

    private showMessage(key: string, duration: number): void {
        this.snackBar.open(this.translate.instant(key), undefined, {
            duration,
            horizontalPosition: 'start',
        });
    }

    private confirmRemove(item: RecordingItem): void {
        this.dialogs.openConfirmDialog({
            title: this.translate.instant(
                'DOWNLOADS.REMOVE_RECORDING_DIALOG.TITLE'
            ),
            message: this.translate.instant(
                'DOWNLOADS.REMOVE_RECORDING_DIALOG.MESSAGE'
            ),
            confirmLabel: this.translate.instant(
                'DOWNLOADS.REMOVE_FROM_MANAGER'
            ),
            onConfirm: () =>
                this.withPending(item.id, () =>
                    this.recordings.removeRecording(item.id)
                ),
        });
    }

    private async runFileAction(
        type: 'play' | 'reveal',
        item: RecordingItem
    ): Promise<RecordingActionResult> {
        const filePath = item.filePath;
        if (!filePath) {
            this.showMessage('DOWNLOADS.FILE_NOT_FOUND', 3000);
            return 'file-missing';
        }
        return this.withPending(
            item.id,
            () =>
                type === 'play'
                    ? this.recordings.playFile(filePath)
                    : this.recordings.revealFile(filePath),
            async (error) => {
                if (error === 'File not found') {
                    // Refresh so the row moves to Needs attention honestly.
                    await this.recordings.loadRecordings();
                }
                this.showMessage(
                    error === 'File not found'
                        ? 'DOWNLOADS.FILE_NOT_FOUND'
                        : 'DOWNLOADS.FILE_ACTION_ERROR',
                    3000
                );
            },
            (error) => (error === 'File not found' ? 'file-missing' : 'failed')
        );
    }

    private async withPending(
        itemId: number,
        operation: () => Promise<RecordingOperationResult>,
        onFailure: (error?: string) => void | Promise<void> = (error) =>
            this.showActionError(error),
        failureResult: (error?: string) => RecordingActionResult = () =>
            'failed'
    ): Promise<RecordingActionResult> {
        if (this.pendingIds().has(itemId)) {
            return 'ignored';
        }
        this.pendingIds.update((ids) => new Set(ids).add(itemId));
        try {
            let failure: string | undefined;
            let failed = false;
            try {
                const result = await operation();
                failed = !result.success;
                failure = result.error;
            } catch (error) {
                failed = true;
                failure =
                    error instanceof Error ? error.message : String(error);
            }
            if (failed) {
                try {
                    await onFailure(failure);
                } catch (error) {
                    this.showActionError(
                        error instanceof Error ? error.message : String(error)
                    );
                }
                return failureResult(failure);
            }
            return 'success';
        } finally {
            this.pendingIds.update((ids) => {
                const next = new Set(ids);
                next.delete(itemId);
                return next;
            });
        }
    }
}
