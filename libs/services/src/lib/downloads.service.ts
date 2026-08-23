import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import type { ElectronBridgeDownloadStartResult } from '@iptvnator/shared/interfaces';
import { DownloadListLoadState } from './download-list-load-state';
import { updateDownloadMetadata } from './downloads-metadata-update';
import type { DownloadItem, DownloadStartInput } from './downloads.models';
import { formatDownloadBytes } from './downloads.utils';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

export type {
    DownloadItem,
    DownloadStartInput,
    DownloadStatus,
} from './downloads.models';

@Injectable({ providedIn: 'root' })
export class DownloadsService implements OnDestroy {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private unsubscribe?: () => void;
    private readonly downloadListLoadState = new DownloadListLoadState();

    /** Signal for the list of downloads */
    readonly downloads = signal<DownloadItem[]>([]);

    /** Whether the download list is currently being loaded */
    readonly isLoadingDownloads = this.downloadListLoadState.isLoading;

    /** Whether the first download list request has completed */
    readonly hasLoadedDownloads = this.downloadListLoadState.hasLoaded;

    /** Whether the latest download list request completed successfully */
    readonly hasAuthoritativeDownloadList =
        this.downloadListLoadState.hasAuthoritativeList;

    /** Whether the download feature is available (Electron only) */
    readonly isAvailable = computed(() => this.runtime.supportsDownloads);

    /** Whether there are any downloads */
    readonly hasDownloads = computed(() => this.downloads().length > 0);

    /** Active downloads count */
    readonly activeCount = computed(
        () =>
            this.downloads().filter(
                (d) => d.status === 'queued' || d.status === 'downloading'
            ).length
    );

    /** Completed downloads count */
    readonly completedCount = computed(
        () => this.downloads().filter((d) => d.status === 'completed').length
    );

    /** Failed downloads count */
    readonly failedCount = computed(
        () =>
            this.downloads().filter(
                (d) => d.status === 'failed' || d.status === 'canceled'
            ).length
    );

    /** Current download folder */
    readonly downloadFolder = signal<string>('');

    constructor() {
        this.init();
    }

    private async init() {
        if (!this.isAvailable()) {
            return;
        }

        // Subscribe BEFORE the initial load, so a transition pinged while
        // that request is pending is coalesced into a trailing refresh
        // instead of being lost with the pre-transition response.
        this.unsubscribe = window.electron.onDownloadsUpdate(() => {
            this.loadDownloads();
        });

        // Load initial download list
        await this.loadDownloads();

        // Load download folder
        await this.loadDownloadFolder();
    }

    ngOnDestroy() {
        this.unsubscribe?.();
    }

    /**
     * Load downloads from the backend. Overlapping callers coalesce behind one
     * serialized trailing refresh.
     */
    async loadDownloads(): Promise<void> {
        if (!this.isAvailable()) return;

        return this.downloadListLoadState.run(async () => {
            try {
                const list = await window.electron.downloadsGetList();
                this.downloads.set(list);
                this.downloadListLoadState.markSucceeded();
            } catch (error) {
                console.error(
                    '[DownloadsService] Error loading downloads:',
                    error
                );
                this.downloadListLoadState.markFailed();
            }
        });
    }

    /**
     * Load or resolve download folder
     */
    async loadDownloadFolder(): Promise<string> {
        if (!this.isAvailable()) return '';

        // The main process owns folder authorization. It returns either the OS
        // default or a custom folder previously selected through a native
        // dialog, rather than trusting renderer-managed settings.
        try {
            const defaultFolder =
                await window.electron.downloadsGetDefaultFolder();
            this.downloadFolder.set(defaultFolder);
            return defaultFolder;
        } catch (error) {
            console.error(
                '[DownloadsService] Error getting default folder:',
                error
            );
            return '';
        }
    }

    /**
     * Start a new download
     */
    async startDownload(
        data: DownloadStartInput
    ): Promise<ElectronBridgeDownloadStartResult> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        const folder = await this.loadDownloadFolder();
        if (!folder) {
            return { success: false, error: 'No download folder configured' };
        }

        try {
            const result = await window.electron.downloadsStart({
                ...data,
                downloadFolder: folder,
            });
            return result;
        } catch (error) {
            console.error('[DownloadsService] Error starting download:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Cancel a download
     */
    async cancelDownload(
        downloadId: number
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        try {
            return await window.electron.downloadsCancel(downloadId);
        } catch (error) {
            console.error(
                '[DownloadsService] Error canceling download:',
                error
            );
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Pause a queued or active download
     */
    async pauseDownload(
        downloadId: number
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        try {
            return await window.electron.downloadsPause(downloadId);
        } catch (error) {
            console.error('[DownloadsService] Error pausing download:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Resume a paused download
     */
    async resumeDownload(
        downloadId: number
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        const folder = await this.loadDownloadFolder();
        if (!folder) {
            return { success: false, error: 'No download folder configured' };
        }

        try {
            return await window.electron.downloadsResume(downloadId, folder);
        } catch (error) {
            console.error('[DownloadsService] Error resuming download:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Retry a failed download
     */
    async retryDownload(
        downloadId: number
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        const folder = await this.loadDownloadFolder();
        if (!folder) {
            return { success: false, error: 'No download folder configured' };
        }

        try {
            return await window.electron.downloadsRetry(downloadId, folder);
        } catch (error) {
            console.error('[DownloadsService] Error retrying download:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Re-download a completed item whose finalized file is unavailable.
     */
    async redownloadMissing(
        downloadId: number
    ): Promise<{ success: boolean; recovered?: boolean; error?: string }> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        try {
            return await window.electron.downloadsRedownloadMissing(downloadId);
        } catch (error) {
            console.error(
                '[DownloadsService] Error re-downloading missing file:',
                error
            );
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Remove a download from the list
     */
    async removeDownload(
        downloadId: number
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        try {
            return await window.electron.downloadsRemove(downloadId);
        } catch (error) {
            console.error('[DownloadsService] Error removing download:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /** Update the offline metadata snapshot for a managed download. */
    async updateMetadata(
        id: number,
        snapshot: DownloadMetadataSnapshot
    ): Promise<{ success: boolean; error?: string }> {
        return updateDownloadMetadata(this, id, snapshot);
    }

    /**
     * Play a downloaded file
     */
    async playDownload(
        filePath: string
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        try {
            return await window.electron.downloadsPlayFile(filePath);
        } catch (error) {
            console.error('[DownloadsService] Error playing file:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Reveal file in system file manager
     */
    async revealFile(
        filePath: string
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Downloads not available' };
        }

        try {
            return await window.electron.downloadsRevealFile(filePath);
        } catch (error) {
            console.error('[DownloadsService] Error revealing file:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Select a new download folder
     */
    async selectFolder(): Promise<string | null> {
        if (!this.isAvailable()) {
            return null;
        }

        try {
            const folder = await window.electron.downloadsSelectFolder();
            if (folder) {
                this.downloadFolder.set(folder);
            }
            return folder;
        } catch (error) {
            console.error('[DownloadsService] Error selecting folder:', error);
            return null;
        }
    }

    /**
     * Clear completed/failed downloads
     */
    async clearCompleted(playlistId?: string): Promise<{ success: boolean }> {
        if (!this.isAvailable()) {
            return { success: false };
        }

        try {
            return await window.electron.downloadsClearCompleted(playlistId);
        } catch (error) {
            console.error(
                '[DownloadsService] Error clearing completed:',
                error
            );
            return { success: false };
        }
    }

    /**
     * Get download progress as percentage
     */
    getProgressPercent(item: DownloadItem): number {
        if (!item.totalBytes || item.totalBytes === 0) {
            return 0;
        }
        return Math.round(
            ((item.bytesDownloaded || 0) / item.totalBytes) * 100
        );
    }

    /**
     * Get a download item by managed id
     */
    getDownload(downloadId: number): DownloadItem | undefined {
        return this.downloads().find(({ id }) => id === downloadId);
    }

    /**
     * Get download item by xtreamId and playlistId
     */
    getDownloadByContent(
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ): DownloadItem | undefined {
        return this.downloads().find(
            (d) =>
                d.xtreamId === xtreamId &&
                d.playlistId === playlistId &&
                d.contentType === contentType
        );
    }

    /**
     * Check if content is downloaded (completed status)
     */
    isDownloaded(
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ): boolean {
        const download = this.getDownloadByContent(
            xtreamId,
            playlistId,
            contentType
        );
        return this.hasAvailableCompletedFile(download);
    }

    /**
     * Check if content is currently downloading, queued, or paused
     */
    isDownloading(
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ): boolean {
        const download = this.getDownloadByContent(
            xtreamId,
            playlistId,
            contentType
        );
        return (
            download?.status === 'downloading' ||
            download?.status === 'queued' ||
            download?.status === 'paused'
        );
    }

    /**
     * Check if content has a paused download
     */
    isPaused(
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ): boolean {
        const download = this.getDownloadByContent(
            xtreamId,
            playlistId,
            contentType
        );
        return download?.status === 'paused';
    }

    /**
     * Resume the paused download that belongs to a content item
     */
    async resumeDownloadByContent(
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ): Promise<{ success: boolean; error?: string }> {
        const download = this.getDownloadByContent(
            xtreamId,
            playlistId,
            contentType
        );
        if (!download || download.status !== 'paused') {
            return { success: false, error: 'No paused download found' };
        }
        return this.resumeDownload(download.id);
    }

    /**
     * Get the file path for a downloaded content item
     */
    getDownloadedFilePath(
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ): string | undefined {
        const download = this.getDownloadByContent(
            xtreamId,
            playlistId,
            contentType
        );
        if (this.hasAvailableCompletedFile(download)) {
            return download.filePath;
        }
        return undefined;
    }

    private hasAvailableCompletedFile(
        item: DownloadItem | undefined
    ): item is DownloadItem & { filePath: string } {
        return (
            item?.status === 'completed' &&
            !!item.filePath &&
            item.fileAvailability !== 'missing'
        );
    }

    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes: number): string {
        return formatDownloadBytes(bytes);
    }
}
