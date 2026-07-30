import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { type DownloadItem, DownloadsService } from '@iptvnator/services';
import { DialogService } from '@iptvnator/ui/components';
import type { DownloadItemAction } from './download-actions';

interface DownloadOperationResult {
    readonly success: boolean;
    readonly error?: string;
}

@Injectable()
export class DownloadManagerActionsService {
    private readonly downloads = inject(DownloadsService);
    private readonly dialogs = inject(DialogService);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);

    readonly pendingIds = signal<ReadonlySet<number>>(new Set());
    readonly isClearing = signal(false);

    async run(action: DownloadItemAction): Promise<void> {
        const { item, type } = action;
        if (this.pendingIds().has(item.id)) {
            return;
        }
        if (type === 'remove') {
            this.confirmRemove(item);
            return;
        }
        if (type === 'copy-url') {
            await this.copyUrl(item);
            return;
        }
        if (type === 'play' || type === 'reveal') {
            await this.runFileAction(type, item);
            return;
        }
        const operations = {
            cancel: () => this.downloads.cancelDownload(item.id),
            pause: () => this.downloads.pauseDownload(item.id),
            resume: () => this.downloads.resumeDownload(item.id),
            retry: () => this.downloads.retryDownload(item.id),
        };
        await this.withPending(item.id, operations[type]);
    }

    clearFinished(scopePlaylistId?: string): void {
        this.dialogs.openConfirmDialog({
            title: this.translate.instant(
                'DOWNLOADS.CLEAR_FINISHED_DIALOG.TITLE'
            ),
            message: this.translate.instant(
                'DOWNLOADS.CLEAR_FINISHED_DIALOG.MESSAGE'
            ),
            confirmLabel: this.translate.instant('DOWNLOADS.CLEAR_FINISHED'),
            onConfirm: () => this.performClearFinished(scopePlaylistId),
        });
    }

    showActionError(error?: string): void {
        const base = this.translate.instant('DOWNLOADS.ACTION_FAILED');
        this.snackBar.open(error ? `${base}: ${error}` : base, undefined, {
            duration: 4000,
            horizontalPosition: 'start',
        });
    }

    showMessage(key: string, duration: number): void {
        this.snackBar.open(this.translate.instant(key), undefined, {
            duration,
            horizontalPosition: 'start',
        });
    }

    private confirmRemove(item: DownloadItem): void {
        const dialogKey =
            item.status === 'completed'
                ? 'DOWNLOADS.REMOVE_COMPLETED_DIALOG'
                : 'DOWNLOADS.REMOVE_PARTIAL_DIALOG';
        this.dialogs.openConfirmDialog({
            title: this.translate.instant(`${dialogKey}.TITLE`),
            message: this.translate.instant(`${dialogKey}.MESSAGE`),
            confirmLabel: this.translate.instant(
                'DOWNLOADS.REMOVE_FROM_MANAGER'
            ),
            onConfirm: () =>
                this.withPending(item.id, () =>
                    this.downloads.removeDownload(item.id)
                ),
        });
    }

    private async performClearFinished(
        scopePlaylistId?: string
    ): Promise<void> {
        if (this.isClearing()) {
            return;
        }
        this.isClearing.set(true);
        try {
            const result = await this.downloads.clearCompleted(scopePlaylistId);
            if (!result.success) {
                this.showActionError();
            }
        } catch (error) {
            this.showActionError(
                error instanceof Error ? error.message : String(error)
            );
        } finally {
            this.isClearing.set(false);
        }
    }

    private async runFileAction(
        type: 'play' | 'reveal',
        item: DownloadItem
    ): Promise<void> {
        const filePath = item.filePath;
        if (!filePath) {
            this.showMessage('DOWNLOADS.FILE_NOT_FOUND', 3000);
            return;
        }
        await this.withPending(
            item.id,
            () =>
                type === 'play'
                    ? this.downloads.playDownload(filePath)
                    : this.downloads.revealFile(filePath),
            (error) => this.showFileActionError(error)
        );
    }

    private async copyUrl(item: DownloadItem): Promise<void> {
        await this.withPending(
            item.id,
            async () => {
                try {
                    await navigator.clipboard.writeText(item.url);
                    this.showMessage('DOWNLOADS.URL_COPIED', 2000);
                    return { success: true };
                } catch {
                    return { success: false };
                }
            },
            () => this.showMessage('DOWNLOADS.URL_COPY_FAILED', 3000)
        );
    }

    private async withPending(
        itemId: number,
        operation: () => Promise<DownloadOperationResult>,
        onFailure: (error?: string) => void = (error) =>
            this.showActionError(error)
    ): Promise<void> {
        if (this.pendingIds().has(itemId)) {
            return;
        }
        this.pendingIds.update((ids) => new Set(ids).add(itemId));
        try {
            const result = await operation();
            if (!result.success) {
                onFailure(result.error);
            }
        } catch (error) {
            onFailure(error instanceof Error ? error.message : String(error));
        } finally {
            this.pendingIds.update((ids) => {
                const next = new Set(ids);
                next.delete(itemId);
                return next;
            });
        }
    }

    private showFileActionError(error?: string): void {
        this.showMessage(
            error === 'File not found'
                ? 'DOWNLOADS.FILE_NOT_FOUND'
                : 'DOWNLOADS.FILE_ACTION_ERROR',
            3000
        );
    }
}
