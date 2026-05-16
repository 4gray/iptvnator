import { Injectable, signal } from '@angular/core';
import {
    PlaylistMeta,
    SourceVpnPreparationReason,
    SourceVpnPreparationRequest,
    VpnIntegrationStatus,
    VpnProvider,
} from 'shared-interfaces';

type SourceVpnElectronApi = {
    prepareSourceVpn?: (
        payload: SourceVpnPreparationRequest
    ) => Promise<VpnIntegrationStatus>;
};

function getSourceVpnElectronApi(): SourceVpnElectronApi | null {
    if (typeof window === 'undefined') {
        return null;
    }

    return (
        (window as Window & { electron?: SourceVpnElectronApi }).electron ??
        null
    );
}

function normalizeProvider(provider: VpnProvider | undefined): VpnProvider {
    return provider === 'proton' ? 'proton' : 'none';
}

function normalizeLocation(location: string | undefined): string {
    const normalized = location?.trim().toUpperCase();
    return normalized ? normalized : 'FASTEST';
}

const RECENT_PREPARATION_DEDUPE_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class SourceVpnPreparationService {
    readonly preparingSourceId = signal<string | null>(null);
    readonly lastStatus = signal<VpnIntegrationStatus | null>(null);
    readonly lastError = signal<string | null>(null);

    private lastAttemptKey: string | null = null;
    private lastAttemptAt = 0;
    private inFlightKey: string | null = null;
    private inFlightPromise: Promise<VpnIntegrationStatus | null> | null = null;

    shouldPrepareForPlaylist(
        playlist: PlaylistMeta | null | undefined,
        reason: SourceVpnPreparationReason
    ): boolean {
        return this.shouldPrepare(playlist, reason);
    }

    hasAutomaticVpn(playlist: PlaylistMeta | null | undefined): boolean {
        return Boolean(
            playlist &&
                normalizeProvider(playlist.vpnProvider) === 'proton' &&
                (playlist.vpnAutoConnectOnOpen ||
                    playlist.vpnAutoConnectWhenDefault)
        );
    }

    getLocation(playlist: PlaylistMeta | null | undefined): string {
        return normalizeLocation(playlist?.vpnLocation);
    }

    async prepareForPlaylist(
        playlist: PlaylistMeta | null | undefined,
        reason: SourceVpnPreparationReason
    ): Promise<VpnIntegrationStatus | null> {
        if (!this.shouldPrepare(playlist, reason)) {
            return null;
        }

        const provider = normalizeProvider(playlist?.vpnProvider);
        const location = normalizeLocation(playlist?.vpnLocation);
        const key = `${playlist?._id ?? ''}:${provider}:${location}`;
        const electron = getSourceVpnElectronApi();

        if (
            key === this.lastAttemptKey &&
            Date.now() - this.lastAttemptAt < RECENT_PREPARATION_DEDUPE_MS
        ) {
            return null;
        }

        if (key === this.inFlightKey && this.inFlightPromise) {
            return this.inFlightPromise;
        }

        this.inFlightKey = key;
        this.preparingSourceId.set(playlist._id);
        this.lastError.set(null);
        this.inFlightPromise = electron!.prepareSourceVpn!({
            location,
            provider,
            reason,
            sourceId: playlist?._id,
            sourceTitle: playlist?.title,
        })
            .then((result) => {
                if (
                    result.status === 'configured' ||
                    result.reason === 'already-prepared'
                ) {
                    this.lastAttemptKey = key;
                    this.lastAttemptAt = Date.now();
                    this.lastError.set(null);
                } else if (
                    result.status === 'failed' ||
                    result.status === 'timeout'
                ) {
                    this.lastError.set(result.reason ?? result.status);
                }
                this.lastStatus.set(result);

                return result;
            })
            .catch((error) => {
                const message =
                    error instanceof Error ? error.message : String(error);
                this.lastError.set(message);
                console.warn('Failed to prepare source VPN.', error);
                return null;
            })
            .finally(() => {
                if (this.inFlightKey === key) {
                    this.inFlightKey = null;
                    this.inFlightPromise = null;
                }
                if (this.preparingSourceId() === playlist._id) {
                    this.preparingSourceId.set(null);
                }
            });

        return this.inFlightPromise;
    }

    private shouldPrepare(
        playlist: PlaylistMeta | null | undefined,
        reason: SourceVpnPreparationReason
    ): playlist is PlaylistMeta {
        const electron = getSourceVpnElectronApi();

        if (
            !playlist ||
            !electron ||
            typeof electron.prepareSourceVpn !== 'function'
        ) {
            return false;
        }

        if (normalizeProvider(playlist.vpnProvider) !== 'proton') {
            return false;
        }

        return reason === 'default-source-startup'
            ? Boolean(playlist.vpnAutoConnectWhenDefault)
            : Boolean(playlist.vpnAutoConnectOnOpen);
    }
}
