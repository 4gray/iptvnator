import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { SettingsStore } from './settings-store.service';

export type DownloadStatus =
    | 'queued'
    | 'downloading'
    | 'completed'
    | 'failed'
    | 'canceled';

export interface DownloadItem {
    id: number;
    playlistId: string;
    xtreamId: number;
    contentType: 'vod' | 'episode';
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    title: string;
    url: string;
    fileName?: string;
    filePath?: string;
    posterUrl?: string;
    status: DownloadStatus;
    bytesDownloaded?: number;
    totalBytes?: number;
    errorMessage?: string;
    createdAt?: string;
    updatedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class DownloadsService implements OnDestroy {
    private readonly settingsStore = inject(SettingsStore);
    private unsubscribe?: () => void;

    /** Signal for the list of downloads */
    readonly downloads = signal<DownloadItem[]>([]);

    /** Whether the download feature is available (Electron only) */
    readonly isAvailable = computed(() => !!window.electron?.downloadsGetList);

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

        // Load initial download list
        await this.loadDownloads();

        // Load download folder
        await this.loadDownloadFolder();

        // Subscribe to download updates
        this.unsubscribe = window.electron.onDownloadsUpdate(() => {
            this.loadDownloads();
        });
    }

    ngOnDestroy() {
        this.unsubscribe?.();
    }

    /**
     * Load downloads from the backend
     */
    async loadDownloads(playlistId?: string): Promise<void> {
        if (!this.isAvailable()) return;

        try {
            const list = await window.electron.downloadsGetList(playlistId);
            this.downloads.set(list);
        } catch (error) {
            console.error('[DownloadsService] Error loading downloads:', error);
        }
    }

    /**
     * Load or resolve download folder
     */
    async loadDownloadFolder(): Promise<string> {
        if (!this.isAvailable()) return '';

        // First check settings
        const storedFolder = this.settingsStore.getDownloadFolder?.();
        if (storedFolder) {
            this.downloadFolder.set(storedFolder);
            return storedFolder;
        }

        // Fall back to default
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
    async startDownload(data: {
        playlistId: string;
        xtreamId: number;
        contentType: 'vod' | 'episode';
        title: string;
        url: string;
        posterUrl?: string;
        headers?: { userAgent?: string; referer?: string; origin?: string };
        seriesXtreamId?: number;
        seasonNumber?: number;
        episodeNumber?: number;
        // Playlist info for auto-creation if needed (Stalker playlists)
        playlistName?: string;
        playlistType?: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';
        serverUrl?: string;
        portalUrl?: string;
        macAddress?: string;
    }): Promise<{ success: boolean; id?: number; error?: string }> {
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
            console.error(
                '[DownloadsService] Error retrying download:',
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
            console.error(
                '[DownloadsService] Error removing download:',
                error
            );
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
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
                // Save to settings
                await this.settingsStore.updateSettings({ downloadFolder: folder });
            }
            return folder;
        } catch (error) {
            console.error(
                '[DownloadsService] Error selecting folder:',
                error
            );
            return null;
        }
    }

    /**
     * Clear completed/failed downloads
     */
    async clearCompleted(
        playlistId?: string
    ): Promise<{ success: boolean }> {
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
        const download = this.getDownloadByContent(xtreamId, playlistId, contentType);
        return download?.status === 'completed' && !!download.filePath;
    }

    /**
     * Check if content is currently downloading or queued
     */
    isDownloading(
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ): boolean {
        const download = this.getDownloadByContent(xtreamId, playlistId, contentType);
        return download?.status === 'downloading' || download?.status === 'queued';
    }

    /**
     * Get the file path for a downloaded content item
     */
    getDownloadedFilePath(
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ): string | undefined {
        const download = this.getDownloadByContent(xtreamId, playlistId, contentType);
        if (download?.status === 'completed') {
            return download.filePath;
        }
        return undefined;
    }

    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}
