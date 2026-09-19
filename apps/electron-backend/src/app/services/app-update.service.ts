import {
    APP_UPDATE_STATUS_CHANGED,
    AppUpdateChannel,
    appUpdateReleasesPageUrl,
    buildAppUpdateReleaseNotesNotFoundMessage,
    appVersionChannel,
    compareAppVersions,
    DEFAULT_APP_UPDATE_CHANNEL,
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateRelease,
    ElectronBridgeAppUpdateReleaseNotes,
    ElectronBridgeAppUpdateReleaseNotesRequest,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateFeedTarget, applyAppUpdateChannel } from './app-update-feed';
import {
    AppUpdateReleaseCatalog,
    CachedGitHubRelease,
    normalizeVersion,
    ReleaseFetcher,
    ReleaseFetchResponse,
} from './app-update-release-catalog';

export const APP_UPDATE_MANUAL_DOWNLOAD_URL = appUpdateReleasesPageUrl(
    DEFAULT_APP_UPDATE_CHANNEL
);

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

interface AppUpdaterAdapter extends AppUpdateFeedTarget {
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

export interface AppUpdateServiceOptions {
    app: AppUpdateAppAdapter;
    appVersion?: string;
    updater: AppUpdaterAdapterProvider;
    getMainWindow: () => AppUpdateWindow | null | undefined;
    platform?: NodeJS.Platform;
    processEnv?: NodeJS.ProcessEnv;
    releaseFetcher?: ReleaseFetcher;
    /** Persisted update channel at startup; `setChannel` follows later saves. */
    channel?: AppUpdateChannel;
    /**
     * Runs right before `quitAndInstall()`. Lets the unsaved-settings close
     * guard stand down for the updater-driven window close, which on macOS
     * happens before `before-quit` and would otherwise be intercepted as a
     * plain close — abandoning the requested install.
     */
    prepareQuit?: () => void;
    /**
     * Undoes {@link prepareQuit} when `quitAndInstall()` failed synchronously
     * and no quit is coming — the prepared one-shot close bypass must not
     * leak into the next genuine close.
     */
    cancelPreparedQuit?: () => void;
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

function resolveCurrentVersion(
    app: AppUpdateAppAdapter,
    appVersion: string | undefined
): string {
    return normalizeVersion(appVersion) || normalizeVersion(app.getVersion());
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
    catalog: AppUpdateReleaseCatalog
): ElectronBridgeAppUpdateReleaseNotes {
    return {
        version: release.version,
        tagName: release.tagName,
        releaseName: release.releaseName,
        publishedAt: release.publishedAt,
        bodyMarkdown: release.bodyMarkdown,
        htmlUrl: release.htmlUrl,
        hasNext: index > 0,
        hasPrevious:
            index < catalog.releases.length - 1 || !catalog.loadedAllReleases,
    };
}

export class AppUpdateService {
    private readonly currentVersion: string;
    private readonly isPackaged: boolean;
    private readonly supportedSelfUpdate: boolean;
    private readonly releaseFetcher: ReleaseFetcher;
    private readonly catalogs = new Map<
        AppUpdateChannel,
        AppUpdateReleaseCatalog
    >();
    private readonly updater: AppUpdaterAdapter | null = null;
    private channel: AppUpdateChannel;
    private checkForUpdatesPromise: Promise<ElectronBridgeAppUpdateStatus> | null =
        null;
    private status: ElectronBridgeAppUpdateStatus;
    /** True between prepareQuit() and the quit — or the error that voids it. */
    private quitPreparationPending = false;

    constructor(private readonly options: AppUpdateServiceOptions) {
        this.currentVersion = resolveCurrentVersion(
            options.app,
            options.appVersion
        );
        this.isPackaged = options.app.isPackaged;
        this.channel = options.channel ?? DEFAULT_APP_UPDATE_CHANNEL;
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
            manualDownloadUrl: appUpdateReleasesPageUrl(this.channel),
            status: getInitialStatus(this.supportedSelfUpdate),
            supportedSelfUpdate: this.supportedSelfUpdate,
            channel: this.channel,
            installedChannel: appVersionChannel(this.currentVersion),
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

    /**
     * Follows a saved channel change. A download already running or
     * finished belongs to the previous channel and is left alone — the
     * user can still install it — so only an idle updater re-checks.
     * `verdictChannel` keeps naming the channel that download came from
     * until a check on the new channel replaces it.
     */
    setChannel(channel: AppUpdateChannel): void {
        if (channel === this.channel) {
            return;
        }

        this.channel = channel;

        const busy =
            this.status.status ===
                ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading ||
            this.status.status ===
                ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded;

        if (busy || !this.isPackaged) {
            this.setStatus({});
            return;
        }

        // The last verdict described the other channel's releases.
        this.setStatus({ latestVersion: undefined, release: undefined });
        void this.checkForUpdates();
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
            latestVersion: undefined,
            release: undefined,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking,
            verdictChannel: this.channel,
        });

        try {
            if (this.updater) {
                applyAppUpdateChannel(this.updater, this.channel);
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

    /**
     * Release notes come from the catalog of the channel the requested
     * version belongs to, not the configured one: a nightly build on the
     * stable channel still reads its own notes, and paging from a nightly
     * tag stays inside the nightly list.
     */
    async getReleaseNotes(
        request: ElectronBridgeAppUpdateReleaseNotesRequest = {}
    ): Promise<ElectronBridgeAppUpdateReleaseNotes> {
        const catalog = this.catalogFor(
            request.version ? appVersionChannel(request.version) : this.channel
        );

        return catalog.runExclusive(() =>
            this.readReleaseNotes(catalog, request)
        );
    }

    /** The exclusive section of `getReleaseNotes`: one reader per catalog. */
    private async readReleaseNotes(
        catalog: AppUpdateReleaseCatalog,
        request: ElectronBridgeAppUpdateReleaseNotesRequest
    ): Promise<ElectronBridgeAppUpdateReleaseNotes> {
        const canFallbackToLatest =
            !request.direction &&
            (!request.version || request.fallbackToLatest);

        if (canFallbackToLatest) {
            await catalog.ensureFirstReleaseLoaded();
        } else {
            await catalog.ensurePageLoaded(1);
        }

        let index = await catalog.findIndex(request.version);

        if (index === -1 && canFallbackToLatest) {
            index = 0;
        }

        if (index === -1) {
            throw new Error(
                buildAppUpdateReleaseNotesNotFoundMessage(request.version)
            );
        }

        if (request.direction === 'previous') {
            index += 1;
            while (
                index >= catalog.releases.length &&
                !catalog.loadedAllReleases
            ) {
                await catalog.ensurePageLoaded(catalog.loadedReleasePages + 1);
            }
        } else if (request.direction === 'next') {
            index -= 1;
        }

        const release = catalog.releases[index];

        if (!release) {
            throw new Error('No release notes are available in that direction');
        }

        return toReleaseNotes(release, index, catalog);
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
            // Consumed by handleError: electron-updater's BaseUpdater
            // catches its own synchronous install failures and emits
            // 'error' instead of throwing, and MacUpdater can return here
            // and fail asynchronously — the revocation must ride the error
            // path, not a try/catch around this call.
            this.quitPreparationPending = true;
            this.options.prepareQuit?.();

            try {
                this.updater.quitAndInstall();
            } catch (error) {
                this.handleError(error);
            }
        }

        return this.getStatus();
    }

    handleUpdateAvailable(info: AppUpdateInfo): void {
        const release = toRelease(info);

        // A release the updater just found is newer than anything the
        // catalogs were loaded with, so their snapshots are stale by
        // definition. Forgetting them keeps the "latest" fallback honest;
        // a version lookup would reload on its own.
        this.catalogs.clear();

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
        // An error after a prepared quit means no quit is coming: take back
        // the one-shot close-guard bypass, whether the failure was thrown
        // synchronously or emitted later as an updater 'error' event.
        if (this.quitPreparationPending) {
            this.quitPreparationPending = false;
            this.options.cancelPreparedQuit?.();
        }

        this.setStatus({
            error: normalizeError(error),
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Error,
        });
    }

    private catalogFor(channel: AppUpdateChannel): AppUpdateReleaseCatalog {
        let catalog = this.catalogs.get(channel);

        if (!catalog) {
            catalog = new AppUpdateReleaseCatalog(
                channel,
                this.releaseFetcher,
                `iptvnator/${this.currentVersion}`
            );
            this.catalogs.set(channel, catalog);
        }

        return catalog;
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

    /**
     * Packaged builds without self-update (Linux deb/rpm/snap/…) only learn
     * whether a newer version exists on the configured channel and point
     * the user at its release page.
     */
    private async checkGitHubReleaseForManualUpdate(): Promise<void> {
        const catalog = this.catalogFor(this.channel);
        const latestRelease = await catalog.runExclusive(async () => {
            await catalog.ensureFirstReleaseLoaded();

            return catalog.latest;
        });

        if (!latestRelease) {
            this.setStatus({
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.NotAvailable,
            });
            return;
        }

        const isNewer =
            compareAppVersions(latestRelease.version, this.currentVersion) > 0;

        this.setStatus({
            error: undefined,
            latestVersion: latestRelease.version,
            release: toReleaseInfo(latestRelease),
            status: isNewer
                ? ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available
                : ELECTRON_BRIDGE_APP_UPDATE_STATUSES.NotAvailable,
        });
    }

    private setStatus(
        update: Partial<
            Omit<
                ElectronBridgeAppUpdateStatus,
                | 'currentVersion'
                | 'manualDownloadUrl'
                | 'supportedSelfUpdate'
                | 'channel'
                | 'installedChannel'
            >
        >
    ): void {
        this.status = {
            ...this.status,
            ...update,
            currentVersion: this.currentVersion,
            manualDownloadUrl: appUpdateReleasesPageUrl(this.channel),
            supportedSelfUpdate: this.supportedSelfUpdate,
            channel: this.channel,
            installedChannel: this.status.installedChannel,
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
