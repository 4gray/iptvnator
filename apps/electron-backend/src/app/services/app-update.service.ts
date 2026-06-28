import {
    APP_UPDATE_STATUS_CHANGED,
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateRelease,
    ElectronBridgeAppUpdateReleaseNotes,
    ElectronBridgeAppUpdateReleaseNotesRequest,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';

export const APP_UPDATE_MANUAL_DOWNLOAD_URL =
    'https://github.com/4gray/iptvnator/releases/latest';
const GITHUB_RELEASES_API_URL =
    'https://api.github.com/repos/4gray/iptvnator/releases';
const GITHUB_RELEASES_PER_PAGE = 10;

interface AppUpdateAppAdapter {
    getVersion(): string;
    isPackaged: boolean;
}

interface AppUpdateWebContents {
    send(channel: string, payload: ElectronBridgeAppUpdateStatus): void;
}

interface AppUpdateWindow {
    isDestroyed(): boolean;
    webContents: AppUpdateWebContents;
}

interface AppUpdateInfo {
    version: string;
    releaseDate?: string;
    releaseName?: string | null;
    releaseNotes?: string | unknown[] | null;
}

interface AppUpdateProgressInfo {
    bytesPerSecond?: number;
    percent: number;
    total?: number;
    transferred?: number;
}

interface AppUpdaterAdapter {
    autoDownload: boolean;
    autoInstallOnAppQuit?: boolean;
    checkForUpdates(): Promise<unknown>;
    downloadUpdate(): Promise<string[]>;
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
    on(event: 'checking-for-update', listener: () => void): this;
    on(
        event: 'update-available',
        listener: (info: AppUpdateInfo) => void
    ): this;
    on(
        event: 'update-not-available',
        listener: (info: AppUpdateInfo) => void
    ): this;
    on(
        event: 'download-progress',
        listener: (progress: AppUpdateProgressInfo) => void
    ): this;
    on(
        event: 'update-downloaded',
        listener: (info: AppUpdateInfo) => void
    ): this;
    on(event: 'error', listener: (error: Error) => void): this;
}

type AppUpdaterAdapterProvider = AppUpdaterAdapter | (() => AppUpdaterAdapter);

interface GitHubReleaseResponse {
    body?: string | null;
    draft?: boolean;
    html_url?: string;
    name?: string | null;
    prerelease?: boolean;
    published_at?: string | null;
    tag_name?: string;
}

interface CachedGitHubRelease {
    bodyMarkdown: string;
    draft: boolean;
    htmlUrl: string;
    prerelease: boolean;
    publishedAt?: string | null;
    releaseName?: string | null;
    tagName: string;
    version: string;
}

interface ReleaseFetchResponse {
    json(): Promise<unknown>;
    ok: boolean;
    status: number;
    statusText: string;
}

type ReleaseFetcher = (
    url: string,
    init?: { headers?: Record<string, string> }
) => Promise<ReleaseFetchResponse>;

export interface AppUpdateServiceOptions {
    app: AppUpdateAppAdapter;
    updater: AppUpdaterAdapterProvider;
    getMainWindow: () => AppUpdateWindow | null | undefined;
    platform?: NodeJS.Platform;
    processEnv?: NodeJS.ProcessEnv;
    releaseFetcher?: ReleaseFetcher;
}

function isSelfUpdateSupported(
    isPackaged: boolean,
    platform: NodeJS.Platform,
    processEnv: NodeJS.ProcessEnv
): boolean {
    if (!isPackaged) {
        return false;
    }

    if (platform === 'darwin' || platform === 'win32') {
        return true;
    }

    return platform === 'linux' && Boolean(processEnv.APPIMAGE);
}

function getInitialStatus(supportedSelfUpdate: boolean) {
    return supportedSelfUpdate
        ? ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle
        : ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported;
}

function toRelease(info: AppUpdateInfo): ElectronBridgeAppUpdateRelease {
    return {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseName: info.releaseName,
        releaseNotes:
            typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    };
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function normalizeVersion(value: string | null | undefined): string {
    return (value ?? '').trim().replace(/^v/i, '');
}

function parseVersionParts(value: string): [number, number, number] | null {
    const match = normalizeVersion(value).match(/^(\d+)\.(\d+)\.(\d+)/);

    if (!match) {
        return null;
    }

    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionGreaterThan(candidate: string, current: string): boolean {
    const candidateParts = parseVersionParts(candidate);
    const currentParts = parseVersionParts(current);

    if (!candidateParts || !currentParts) {
        return false;
    }

    for (let index = 0; index < candidateParts.length; index += 1) {
        if (candidateParts[index] !== currentParts[index]) {
            return candidateParts[index] > currentParts[index];
        }
    }

    return false;
}

function toReleaseInfo(
    release: CachedGitHubRelease
): ElectronBridgeAppUpdateRelease {
    return {
        version: release.version,
        releaseDate: release.publishedAt ?? undefined,
        releaseName: release.releaseName,
        releaseNotes: null,
    };
}

function toReleaseNotes(
    release: CachedGitHubRelease,
    index: number,
    releaseCount: number,
    loadedAllReleases: boolean
): ElectronBridgeAppUpdateReleaseNotes {
    return {
        version: release.version,
        tagName: release.tagName,
        releaseName: release.releaseName,
        publishedAt: release.publishedAt,
        bodyMarkdown: release.bodyMarkdown,
        htmlUrl: release.htmlUrl,
        hasNext: index > 0,
        hasPrevious: index < releaseCount - 1 || !loadedAllReleases,
    };
}

function isGitHubRelease(value: unknown): value is GitHubReleaseResponse {
    return Boolean(
        value &&
        typeof value === 'object' &&
        'tag_name' in value &&
        typeof (value as GitHubReleaseResponse).tag_name === 'string'
    );
}

export class AppUpdateService {
    private readonly currentVersion: string;
    private readonly isPackaged: boolean;
    private readonly supportedSelfUpdate: boolean;
    private readonly releaseFetcher: ReleaseFetcher;
    private readonly releases: CachedGitHubRelease[] = [];
    private readonly updater: AppUpdaterAdapter | null = null;
    private loadedReleasePages = 0;
    private loadedAllReleases = false;
    private checkForUpdatesPromise: Promise<ElectronBridgeAppUpdateStatus> | null =
        null;
    private status: ElectronBridgeAppUpdateStatus;

    constructor(private readonly options: AppUpdateServiceOptions) {
        this.currentVersion = options.app.getVersion();
        this.isPackaged = options.app.isPackaged;
        this.supportedSelfUpdate = isSelfUpdateSupported(
            options.app.isPackaged,
            options.platform ?? process.platform,
            options.processEnv ?? process.env
        );
        this.releaseFetcher =
            options.releaseFetcher ??
            ((url, init) => fetch(url, init) as Promise<ReleaseFetchResponse>);
        this.status = {
            currentVersion: this.currentVersion,
            manualDownloadUrl: APP_UPDATE_MANUAL_DOWNLOAD_URL,
            status: getInitialStatus(this.supportedSelfUpdate),
            supportedSelfUpdate: this.supportedSelfUpdate,
        };

        if (this.supportedSelfUpdate) {
            this.updater = this.resolveUpdater(options.updater);
            this.updater.autoDownload = false;
            this.updater.autoInstallOnAppQuit = false;
            this.attachUpdaterEvents(this.updater);
        }
    }

    getStatus(): ElectronBridgeAppUpdateStatus {
        return { ...this.status };
    }

    async checkForUpdates(): Promise<ElectronBridgeAppUpdateStatus> {
        if (this.checkForUpdatesPromise) {
            return this.checkForUpdatesPromise;
        }

        this.checkForUpdatesPromise = this.runCheckForUpdates().finally(() => {
            this.checkForUpdatesPromise = null;
        });

        return this.checkForUpdatesPromise;
    }

    private async runCheckForUpdates(): Promise<ElectronBridgeAppUpdateStatus> {
        if (!this.isPackaged) {
            this.setStatus({
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported,
            });
            return this.getStatus();
        }

        this.setStatus({
            error: undefined,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking,
        });

        try {
            if (this.updater) {
                await this.updater.checkForUpdates();
            } else {
                await this.checkGitHubReleaseForManualUpdate();
            }
        } catch (error) {
            this.handleError(error);
        }

        return this.getStatus();
    }

    async checkForUpdatesOnStartup(): Promise<ElectronBridgeAppUpdateStatus> {
        if (!this.isPackaged) {
            return this.getStatus();
        }

        return this.checkForUpdates();
    }

    async getReleaseNotes(
        request: ElectronBridgeAppUpdateReleaseNotesRequest = {}
    ): Promise<ElectronBridgeAppUpdateReleaseNotes> {
        await this.ensureReleasePageLoaded(1);

        let index = await this.findReleaseIndex(request.version);

        if (index === -1 && !request.version) {
            index = 0;
        }

        if (index === -1) {
            throw new Error(
                `Release notes were not found for ${request.version ?? 'latest release'}`
            );
        }

        if (request.direction === 'previous') {
            index += 1;
            while (index >= this.releases.length && !this.loadedAllReleases) {
                await this.ensureReleasePageLoaded(this.loadedReleasePages + 1);
            }
        } else if (request.direction === 'next') {
            index -= 1;
        }

        const release = this.releases[index];

        if (!release) {
            throw new Error('No release notes are available in that direction');
        }

        return toReleaseNotes(
            release,
            index,
            this.releases.length,
            this.loadedAllReleases
        );
    }

    async downloadUpdate(): Promise<ElectronBridgeAppUpdateStatus> {
        if (!this.updater) {
            this.setStatus({
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported,
            });
            return this.getStatus();
        }

        if (
            this.status.status !== ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available
        ) {
            return this.getStatus();
        }

        this.setStatus({
            error: undefined,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading,
        });

        try {
            await this.updater.downloadUpdate();
        } catch (error) {
            this.handleError(error);
        }

        return this.getStatus();
    }

    installUpdate(): ElectronBridgeAppUpdateStatus {
        if (
            this.updater &&
            this.status.status ===
                ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
        ) {
            this.updater.quitAndInstall();
        }

        return this.getStatus();
    }

    handleUpdateAvailable(info: AppUpdateInfo): void {
        const release = toRelease(info);
        this.setStatus({
            error: undefined,
            latestVersion: release.version,
            release,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
        });
    }

    handleUpdateNotAvailable(info: AppUpdateInfo): void {
        this.setStatus({
            error: undefined,
            latestVersion: info.version,
            release: toRelease(info),
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.NotAvailable,
        });
    }

    handleDownloadProgress(progress: AppUpdateProgressInfo): void {
        this.setStatus({
            progress: {
                bytesPerSecond: progress.bytesPerSecond,
                percent: progress.percent,
                total: progress.total,
                transferred: progress.transferred,
            },
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading,
        });
    }

    handleUpdateDownloaded(info: AppUpdateInfo): void {
        const release = toRelease(info);
        this.setStatus({
            latestVersion: release.version,
            release,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded,
        });
    }

    handleError(error: unknown): void {
        this.setStatus({
            error: normalizeError(error),
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Error,
        });
    }

    private resolveUpdater(
        updater: AppUpdaterAdapterProvider
    ): AppUpdaterAdapter {
        return typeof updater === 'function' ? updater() : updater;
    }

    private attachUpdaterEvents(updater: AppUpdaterAdapter): void {
        updater.on('checking-for-update', () => {
            this.setStatus({
                error: undefined,
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking,
            });
        });
        updater.on('update-available', (info) =>
            this.handleUpdateAvailable(info)
        );
        updater.on('update-not-available', (info) =>
            this.handleUpdateNotAvailable(info)
        );
        updater.on('download-progress', (progress) =>
            this.handleDownloadProgress(progress)
        );
        updater.on('update-downloaded', (info) =>
            this.handleUpdateDownloaded(info)
        );
        updater.on('error', (error) => this.handleError(error));
    }

    private async checkGitHubReleaseForManualUpdate(): Promise<void> {
        await this.ensureFirstStableReleaseLoaded();
        const latestRelease = this.releases[0];

        if (!latestRelease) {
            this.setStatus({
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.NotAvailable,
            });
            return;
        }

        if (isVersionGreaterThan(latestRelease.version, this.currentVersion)) {
            this.setStatus({
                error: undefined,
                latestVersion: latestRelease.version,
                release: toReleaseInfo(latestRelease),
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
            });
            return;
        }

        this.setStatus({
            error: undefined,
            latestVersion: latestRelease.version,
            release: toReleaseInfo(latestRelease),
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.NotAvailable,
        });
    }

    private async ensureFirstStableReleaseLoaded(): Promise<void> {
        while (!this.loadedAllReleases && this.releases.length === 0) {
            await this.ensureReleasePageLoaded(this.loadedReleasePages + 1);
        }
    }

    private async findReleaseIndex(
        version: string | undefined
    ): Promise<number> {
        if (!version) {
            return -1;
        }

        const normalizedVersion = normalizeVersion(version);

        while (true) {
            const index = this.releases.findIndex(
                (release) =>
                    normalizeVersion(release.version) === normalizedVersion ||
                    normalizeVersion(release.tagName) === normalizedVersion
            );

            if (index !== -1 || this.loadedAllReleases) {
                return index;
            }

            await this.ensureReleasePageLoaded(this.loadedReleasePages + 1);
        }
    }

    private async ensureReleasePageLoaded(page: number): Promise<void> {
        while (!this.loadedAllReleases && this.loadedReleasePages < page) {
            await this.loadReleasePage(this.loadedReleasePages + 1);
        }
    }

    private async loadReleasePage(page: number): Promise<void> {
        const url = `${GITHUB_RELEASES_API_URL}?per_page=${GITHUB_RELEASES_PER_PAGE}&page=${page}`;
        const response = await this.releaseFetcher(url, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': `iptvnator/${this.currentVersion}`,
            },
        });

        if (!response.ok) {
            throw new Error(
                `GitHub releases request failed: ${response.status} ${response.statusText}`
            );
        }

        const payload = await response.json();

        if (!Array.isArray(payload)) {
            throw new Error('GitHub releases response was not an array');
        }

        for (const release of payload) {
            if (!isGitHubRelease(release)) {
                continue;
            }

            if (release.draft || release.prerelease) {
                continue;
            }

            const tagName = release.tag_name;
            const version = normalizeVersion(tagName);

            if (
                this.releases.some(
                    (cachedRelease) => cachedRelease.tagName === tagName
                )
            ) {
                continue;
            }

            this.releases.push({
                bodyMarkdown: release.body ?? '',
                draft: Boolean(release.draft),
                htmlUrl:
                    release.html_url ??
                    `${APP_UPDATE_MANUAL_DOWNLOAD_URL.replace('/latest', '')}/tag/${tagName}`,
                prerelease: Boolean(release.prerelease),
                publishedAt: release.published_at,
                releaseName: release.name ?? tagName,
                tagName,
                version,
            });
        }

        this.loadedReleasePages = page;
        this.loadedAllReleases = payload.length < GITHUB_RELEASES_PER_PAGE;
    }

    private setStatus(
        update: Partial<
            Omit<
                ElectronBridgeAppUpdateStatus,
                'currentVersion' | 'manualDownloadUrl' | 'supportedSelfUpdate'
            >
        >
    ): void {
        this.status = {
            ...this.status,
            ...update,
            currentVersion: this.currentVersion,
            manualDownloadUrl: APP_UPDATE_MANUAL_DOWNLOAD_URL,
            supportedSelfUpdate: this.supportedSelfUpdate,
        };
        this.emitStatus();
    }

    private emitStatus(): void {
        const mainWindow = this.options.getMainWindow();

        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        mainWindow.webContents.send(
            APP_UPDATE_STATUS_CHANGED,
            this.getStatus()
        );
    }
}
