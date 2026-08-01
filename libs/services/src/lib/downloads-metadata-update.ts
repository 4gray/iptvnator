import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';

interface DownloadMetadataHost {
    isAvailable(): boolean;
    loadDownloads(): Promise<void>;
}

export async function updateDownloadMetadata(
    host: DownloadMetadataHost,
    downloadId: number,
    metadataSnapshot: DownloadMetadataSnapshot
): Promise<{ success: boolean; error?: string }> {
    if (!host.isAvailable()) return { success: false };

    try {
        const result = await window.electron.downloadsUpdateMetadata(
            downloadId,
            metadataSnapshot
        );
        if (result.success) await host.loadDownloads();
        return result;
    } catch (error) {
        console.error('[DownloadsService] Metadata update error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
