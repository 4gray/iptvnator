import { inject, Injectable, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DialogService } from '@iptvnator/ui/components';
import {
    DataService,
    DatabaseService,
    type DbOperationEvent,
    isDbAbortError,
    PlaylistRefreshService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
    SourceActivityService,
} from '@iptvnator/services';
import { ChannelActions, PlaylistActions } from '@iptvnator/m3u-state';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    normalizeHost,
    parseSecurityPolicyError,
    PLAYLIST_UPDATE,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { firstValueFrom } from 'rxjs';
import {
    XtreamRefreshFlowService,
    type XtreamRefreshProgressReporter,
} from './xtream-refresh-flow.service';

/** What an M3U refresh did; a failure has already been reported. */
export type M3uRefreshOutcome = 'refreshed' | 'failed' | 'skipped';

export interface XtreamRefreshPreparationState {
    playlistId: string;
    operationId: string;
    phase: string;
    current?: number;
    total?: number;
}

@Injectable({ providedIn: 'root' })
export class PlaylistRefreshActionService {
    private readonly store = inject(Store);
    private readonly activity = inject(SourceActivityService);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly dialogService = inject(DialogService);
    private readonly databaseService = inject(DatabaseService);
    private readonly dataService = inject(DataService);
    private readonly playlistRefreshService = inject(PlaylistRefreshService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly xtreamRefreshFlow = inject(XtreamRefreshFlowService);

    private readonly refreshPreparationState =
        signal<XtreamRefreshPreparationState | null>(null);

    private readonly m3uRefreshId = signal<string | null>(null);
    isSourceBusy(id: string): boolean {
        return (
            this.m3uRefreshId() === id ||
            this.refreshPreparation()?.playlistId === id
        );
    }
    readonly isRefreshing = signal(false);
    readonly refreshPreparation = this.refreshPreparationState.asReadonly();

    canRefresh(playlist: PlaylistMeta | null): boolean {
        // The same guards as refresh(): one refresh runs at a time, so an
        // offer made meanwhile would be a silent no-op.
        if (
            !playlist ||
            this.isRefreshing() ||
            this.activity.isBusy(playlist._id)
        ) {
            return false;
        }

        if (playlist.serverUrl) {
            return this.runtime.supportsXtreamSqliteDataSource;
        }

        if (playlist.url) {
            return true;
        }

        return (
            this.runtime.supportsPlaylistRefresh && Boolean(playlist.filePath)
        );
    }

    /** Whether refresh() would skip this playlist right now. */
    isBlocked(playlistId: string): boolean {
        return this.isRefreshing() || this.activity.isBusy(playlistId);
    }

    refresh(playlist: PlaylistMeta): void {
        if (this.isBlocked(playlist._id)) {
            return;
        }

        if (playlist.serverUrl && this.runtime.supportsXtreamSqliteDataSource) {
            this.refreshXtream(playlist);
        } else {
            void this.refreshM3uSource(playlist);
        }
    }

    /**
     * Fetches an M3U playlist again from its URL or file and settles with the
     * outcome, so a caller that just changed the source can report it (#1677).
     */
    async refreshM3uSource(playlist: PlaylistMeta): Promise<M3uRefreshOutcome> {
        if (this.isBlocked(playlist._id)) {
            return 'skipped';
        }
        if (
            this.runtime.supportsPlaylistRefresh &&
            (playlist.url || playlist.filePath)
        ) {
            return this.refreshM3u(playlist);
        }
        if (playlist.url) {
            return this.refreshViaBackend(playlist, playlist.url);
        }
        return 'skipped';
    }

    /** Keep the source busy until the browser refresh reports its result. */
    private async refreshViaBackend(
        item: PlaylistMeta,
        url: string
    ): Promise<M3uRefreshOutcome> {
        this.m3uRefreshId.set(item._id);
        this.isRefreshing.set(true);
        const release = this.activity.begin([item._id]);
        try {
            // The browser runtime reports and resolves false on failure.
            const loaded = await this.dataService.sendIpcEvent<boolean>(
                PLAYLIST_UPDATE,
                {
                    id: item._id,
                    title: item.title,
                    url,
                    ...(item.userAgent ? { userAgent: item.userAgent } : {}),
                }
            );
            return loaded === false ? 'failed' : 'refreshed';
        } catch (error) {
            console.error('Error refreshing playlist:', error);
            this.snackBar.open(
                this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_ERROR'),
                this.translate.instant('CLOSE'),
                { duration: 5000 }
            );
            return 'failed';
        } finally {
            this.m3uRefreshId.set(null);
            this.isRefreshing.set(false);
            release();
        }
    }

    private refreshXtream(item: PlaylistMeta): void {
        this.xtreamRefreshFlow.confirmAndRefresh(
            item,
            this.xtreamRefreshReporter
        );
    }

    /**
     * Reports the shared destructive refresh as one global preparation state:
     * this action has no row to attach progress to, so the flow is either
     * refreshing or it is not. Events are scoped to their operation, since a
     * cancelled run's worker can still emit after the next one has started.
     */
    private readonly xtreamRefreshReporter: XtreamRefreshProgressReporter = {
        isBusy: () => this.isRefreshing(),
        begin: ({ playlistId, operationId }) => {
            this.isRefreshing.set(true);
            this.refreshPreparationState.set({
                playlistId,
                operationId,
                phase: 'collecting-user-data',
            });
        },
        report: ({ playlistId, operationId }, event) =>
            this.updateRefreshPreparationFromEvent(
                playlistId,
                operationId,
                event
            ),
        end: ({ operationId }) => {
            this.clearRefreshPreparation(operationId);
            this.isRefreshing.set(false);
        },
        waitForVisibleProgress: () => this.waitForRefreshPreparationPaint(),
    };

    private async refreshM3u(item: PlaylistMeta): Promise<M3uRefreshOutcome> {
        const isActiveM3uRoute =
            this.playlistContext.routeProvider() === 'playlists' &&
            this.playlistContext.resolvedPlaylistId() === item._id;

        this.m3uRefreshId.set(item._id);
        this.isRefreshing.set(true);
        // Seen by the Sources page and the removal guard as well.
        const release = this.activity.begin([item._id]);
        if (isActiveM3uRoute) {
            this.store.dispatch(
                ChannelActions.setChannelsLoading({ loading: true })
            );
        }

        try {
            const operationId =
                this.databaseService.createOperationId('playlist-refresh');
            const refreshedPlaylist =
                await this.playlistRefreshService.refreshPlaylist({
                    operationId,
                    playlistId: item._id,
                    title: item.title,
                    url: item.url,
                    ...(item.userAgent ? { userAgent: item.userAgent } : {}),
                    filePath: item.filePath,
                    trustedInsecureTlsHosts:
                        this.settingsStore.getTrustOptions()
                            .trustedInsecureTlsHosts,
                });

            // Saved before it is published, as the browser refresh does, so
            // success means the channels are stored and a write failure is
            // reported instead of lost in the effect (#1677).
            const saved = await firstValueFrom(
                this.playlistsService.updatePlaylist(
                    item._id,
                    { ...refreshedPlaylist, _id: item._id },
                    operationId
                )
            );
            this.store.dispatch(
                PlaylistActions.updatePlaylist({
                    playlist: saved,
                    playlistId: item._id,
                    refreshEpg: true,
                    operationId,
                    persist: false,
                })
            );

            this.snackBar.open(
                this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                undefined,
                { duration: 2000 }
            );
            return 'refreshed';
        } catch (error) {
            if (!isDbAbortError(error)) {
                console.error('Error refreshing playlist:', error);
                if (
                    item.url &&
                    this.handlePlaylistSecurityError(error, () =>
                        this.refresh(item)
                    )
                ) {
                    return 'failed';
                }
                this.snackBar.open(
                    this.getRefreshErrorMessage(error, item),
                    this.translate.instant('CLOSE'),
                    { duration: 5000 }
                );
            }
            return 'failed';
        } finally {
            if (isActiveM3uRoute) {
                this.store.dispatch(
                    ChannelActions.setChannelsLoading({ loading: false })
                );
            }
            this.m3uRefreshId.set(null);
            this.isRefreshing.set(false);
            release();
        }
    }

    private getRefreshErrorMessage(error: unknown, item: PlaylistMeta): string {
        if (
            error instanceof Error &&
            error.message?.includes('ENOENT') &&
            item.filePath
        ) {
            return this.translate.instant(
                'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_NOT_FOUND'
            );
        }

        return this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_ERROR');
    }

    private handlePlaylistSecurityError(
        error: unknown,
        retry: () => void
    ): boolean {
        const securityError = parseSecurityPolicyError(error);
        if (
            securityError?.code !==
            ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate
        ) {
            return false;
        }

        const ref = this.snackBar.open(
            this.translate.instant('HOME.URL_UPLOAD.ERROR_INVALID_TLS'),
            this.translate.instant('HOME.URL_UPLOAD.TRUST_TLS_HOST'),
            { duration: 10000 }
        );
        ref.onAction().subscribe(() => {
            this.confirmTrustPlaylistHost(securityError.host, retry);
        });
        return true;
    }

    private confirmTrustPlaylistHost(
        host: string | undefined,
        retry: () => void
    ): void {
        if (!host) {
            this.snackBar.open(
                this.translate.instant(
                    'HOME.URL_UPLOAD.ERROR_TLS_HOST_UNKNOWN'
                ),
                this.translate.instant('CLOSE'),
                { duration: 5000 }
            );
            return;
        }

        this.dialogService.openConfirmDialog({
            title: this.translate.instant(
                'HOME.URL_UPLOAD.TRUST_TLS_HOST_TITLE'
            ),
            subtitle: this.translate.instant('DIALOGS.TLS_HOST', { host }),
            message: this.translate.instant(
                'HOME.URL_UPLOAD.TRUST_TLS_HOST_WARNING'
            ),
            confirmLabel: this.translate.instant(
                'HOME.URL_UPLOAD.TRUST_TLS_HOST'
            ),
            width: '420px',
            onConfirm: () => {
                void this.trustPlaylistHost(host).then(retry);
            },
        });
    }

    private async trustPlaylistHost(host: string): Promise<void> {
        const settings = this.settingsStore.getSettings();
        const trustedHosts = new Set(
            (settings.trustedInsecureTlsHosts ?? []).map((item) =>
                normalizeHost(item)
            )
        );
        trustedHosts.add(normalizeHost(host));

        await this.settingsStore.updateSettings({
            trustedInsecureTlsHosts: Array.from(trustedHosts),
        });
    }

    private updateRefreshPreparationFromEvent(
        playlistId: string,
        operationId: string,
        event: DbOperationEvent
    ): void {
        if (event.operationId && event.operationId !== operationId) {
            return;
        }

        this.refreshPreparationState.update((current) => {
            if (!current || current.operationId !== operationId) {
                return current;
            }

            return {
                playlistId,
                operationId,
                phase: event.phase ?? current.phase,
                current: event.current ?? current.current,
                total: event.total ?? current.total,
            };
        });
    }

    private clearRefreshPreparation(operationId: string): void {
        this.refreshPreparationState.update((current) =>
            current?.operationId === operationId ? null : current
        );
    }

    private async waitForRefreshPreparationPaint(): Promise<void> {
        const minimumVisibleDelayMs = 120;

        // Give Angular a paint opportunity before small cached playlists can
        // finish cleanup and clear the preparation state.
        const resolveAfterDelay = (resolve: () => void): void => {
            setTimeout(resolve, minimumVisibleDelayMs);
        };

        if (typeof requestAnimationFrame !== 'function') {
            await new Promise<void>(resolveAfterDelay);
            return;
        }

        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolveAfterDelay(resolve));
        });
    }
}
