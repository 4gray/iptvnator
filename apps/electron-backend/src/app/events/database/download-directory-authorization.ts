import { resolve } from 'node:path';

export interface DownloadDirectoryAuthorizerOptions {
    getDefaultDirectory: () => string;
    loadSelectedDirectory: () => Promise<string | null>;
    saveSelectedDirectory: (directory: string) => Promise<void>;
    platform?: NodeJS.Platform;
}

function normalizeDirectory(directory: string): string {
    const value = String(directory ?? '').trim();
    if (!value) {
        throw new Error('Download directory is required');
    }
    return resolve(value);
}

function directoryKey(directory: string, platform: NodeJS.Platform): string {
    const normalized = normalizeDirectory(directory);
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Keeps download-directory authorization in the Electron main process.
 * Only the OS default or a directory persisted after a native dialog may be
 * used by renderer-triggered download IPC calls.
 */
export class DownloadDirectoryAuthorizer {
    private selectedDirectory: string | null | undefined;

    constructor(private readonly options: DownloadDirectoryAuthorizerOptions) {}

    private async loadSelectedDirectory(): Promise<string | null> {
        if (this.selectedDirectory !== undefined) {
            return this.selectedDirectory;
        }

        const storedDirectory = await this.options.loadSelectedDirectory();
        this.selectedDirectory = storedDirectory
            ? normalizeDirectory(storedDirectory)
            : null;
        return this.selectedDirectory;
    }

    async getPreferredDirectory(): Promise<string> {
        return (
            (await this.loadSelectedDirectory()) ??
            normalizeDirectory(this.options.getDefaultDirectory())
        );
    }

    async authorizeSelectedDirectory(directory: string): Promise<string> {
        const normalized = normalizeDirectory(directory);
        await this.options.saveSelectedDirectory(normalized);
        this.selectedDirectory = normalized;
        return normalized;
    }

    async requireAuthorized(directory: string): Promise<string> {
        const normalized = normalizeDirectory(directory);
        const defaultDirectory = normalizeDirectory(
            this.options.getDefaultDirectory()
        );
        const selectedDirectory = await this.loadSelectedDirectory();
        const platform = this.options.platform ?? process.platform;
        const requestedKey = directoryKey(normalized, platform);

        if (
            requestedKey !== directoryKey(defaultDirectory, platform) &&
            (!selectedDirectory ||
                requestedKey !== directoryKey(selectedDirectory, platform))
        ) {
            throw new Error(
                'Download directory was not authorized by a native folder dialog'
            );
        }

        return normalized;
    }
}
