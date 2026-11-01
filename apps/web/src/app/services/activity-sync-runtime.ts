import { createActivityRuntimeClient } from './activity-runtime-client';
import {
    readActivityConsent,
    type ActivityConsent,
} from './activity-consent-state';
import { announceActivityChange } from '@iptvnator/services/activity-changes';
import { createRandomId } from '@iptvnator/shared/interfaces';
import {
    DestroyRef,
    Injectable,
    computed,
    inject,
    signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    PlaybackPositionRuntimeBridgeService,
} from '@iptvnator/services';
import {
    SourceSyncService,
    requestSourceServer,
} from '@iptvnator/services/source-sync';
import { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import {
    ACTIVITY_SYNC_CAPABILITY,
    type ActivityAddress,
    type ActivityLocalRecord,
} from '@iptvnator/shared/interfaces/activity-sync';
import {
    ElectronXtreamDataSource,
    PwaXtreamDataSource,
    type IXtreamDataSource,
} from '@iptvnator/portal/xtream/data-access';
import type {
    PlaybackPositionData,
    PlayerContentInfo,
    ServerInstanceInfo,
} from '@iptvnator/shared/interfaces';
import { activityConsentKey, activityEnabled } from './activity-consent';
import { ActivityPositionAdapter } from './activity-position-adapter';

@Injectable({ providedIn: 'root' })
export class ActivitySyncRuntime {
    private readonly capabilities = inject(RuntimeCapabilitiesService);
    private readonly sources = inject(SourceSyncService);
    private readonly playlists = inject(PlaylistsService);
    private readonly positionsBridge = inject(
        PlaybackPositionRuntimeBridgeService
    );
    private readonly destroy = inject(DestroyRef);
    private readonly raw = this.capabilities.supportsXtreamSqliteDataSource
        ? inject(ElectronXtreamDataSource)
        : inject(PwaXtreamDataSource);
    private client?: ActivitySyncClient;
    private adapter?: ActivityPositionAdapter;
    private timer?: ReturnType<typeof setInterval>;
    private refreshing?: Promise<void>;
    readonly enabled = signal(activityEnabled());
    readonly state = signal('disabled');
    readonly stateKey = computed(
        () =>
            ({
                disabled: 'ACTIVITY_SYNC.STATE_disabled',
                initializing: 'ACTIVITY_SYNC.STATE_initializing',
                ready: 'ACTIVITY_SYNC.STATE_ready',
                pending: 'ACTIVITY_SYNC.STATE_pending',
                offline: 'ACTIVITY_SYNC.STATE_offline',
                conflict: 'ACTIVITY_SYNC.STATE_conflict',
                incompatible: 'ACTIVITY_SYNC.STATE_incompatible',
                locked: 'SOURCE_SYNC.STATE_locked',
            })[this.state()] ?? 'ACTIVITY_SYNC.ERROR'
    );
    readonly pending = signal(0);
    readonly conflicts = signal<
        { address: ActivityAddress; record: ActivityLocalRecord }[]
    >([]);
    readonly lastSync = signal<Date | null>(null);
    readonly busy = signal(false);
    readonly error = signal(false);

    constructor() {
        const refresh = () => {
            this.enabled.set(activityEnabled());
            if (this.enabled())
                void this.start().catch(() => this.state.set('offline'));
        };
        window.addEventListener('online', refresh);
        window.addEventListener('focus', refresh);
        window.addEventListener('storage', refresh);
        if (this.enabled())
            queueMicrotask(
                () => void this.start().catch(() => this.state.set('offline'))
            );
        this.destroy.onDestroy(() => {
            clearInterval(this.timer);
            window.removeEventListener('online', refresh);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('storage', refresh);
        });
    }

    async start(): Promise<void> {
        if (!this.enabled()) return;
        this.ensureClient();
        if (!this.timer)
            this.timer = setInterval(() => {
                if (!document.hidden) void this.refresh();
            }, 5000);
        await this.refresh();
    }

    async setEnabled(enabled: boolean): Promise<void> {
        this.busy.set(true);
        this.error.set(false);
        try {
            const key = activityConsentKey();
            if (!key) throw new Error('No activity profile');
            let previous: ActivityConsent | null;
            try {
                previous = readActivityConsent();
            } catch {
                previous = null;
            }
            if (enabled) {
                if (!this.capabilities.supportsActivityStorage)
                    throw new Error('Activity storage unavailable');
                await this.sources.refresh();
                const response = await requestSourceServer({
                    operation: 'instance',
                });
                if (
                    !(
                        response.body as ServerInstanceInfo
                    )?.capabilities?.includes(ACTIVITY_SYNC_CAPABILITY)
                ) {
                    this.state.set('incompatible');
                    throw new Error('Activity server incompatible');
                }
            } else if (this.client) {
                // Stop delivery first. Local mirror failure must remain visible/retryable.
                localStorage.setItem(
                    key,
                    JSON.stringify({ ...previous, enabled: false })
                );
                this.enabled.set(false);
                clearInterval(this.timer);
                this.timer = undefined;
                await this.client.stopDelivery();
                for (const sourceId of await this.sourceIds())
                    await this.adapter?.keepLocal(this.raw, sourceId);
            }
            localStorage.setItem(
                key,
                JSON.stringify({
                    enabled,
                    generation: createRandomId(),
                    deviceId: previous?.deviceId ?? createRandomId(),
                })
            );
            this.enabled.set(enabled);
            this.state.set(enabled ? 'initializing' : 'disabled');
            if (enabled) await this.start();
        } catch {
            this.error.set(true);
        } finally {
            this.busy.set(false);
        }
    }

    async begin(position: PlayerContentInfo, startTime = 0): Promise<void> {
        if (!this.enabled()) return;
        try {
            await this.ensureClient().begin(position.playlistId!, {
                ...position,
                positionSeconds: startTime,
            });
        } catch {
            this.state.set('offline');
        }
    }

    async checkpoint(position: PlaybackPositionData): Promise<void> {
        if (!activityEnabled()) return;
        try {
            this.ensureClient();
            await this.adapter!.invoke(this.raw, 'savePlaybackPosition', [
                position.playlistId!,
                position,
            ]);
        } catch {
            this.state.set('offline');
        }
    }

    register(sourceId: string, positions: PlaybackPositionData[]): void {
        this.ensureClient().register(sourceId, positions);
    }

    async invoke(
        raw: IXtreamDataSource,
        method: string,
        args: unknown[]
    ): Promise<unknown> {
        const methods = new Set([
            'savePlaybackPosition',
            'getPlaybackPosition',
            'getSeriesPlaybackPositions',
            'getAllPlaybackPositions',
            'getRecentPlaybackPositions',
            'clearPlaybackPosition',
            'savePlaybackPositionsBatch',
            'clearPlaybackPositionsBatch',
        ]);
        if (!activityEnabled() || !methods.has(method))
            return Reflect.get(raw, method).apply(raw, args);
        this.ensureClient();
        try {
            return await this.adapter!.invoke(raw, method, args);
        } catch (error) {
            this.state.set('offline');
            throw error;
        }
    }

    refresh(): Promise<void> {
        if (!activityEnabled()) return Promise.resolve();
        return (this.refreshing ??= this.refreshSources().finally(() => {
            this.refreshing = undefined;
        }));
    }

    async resolve(address: ActivityAddress, useLocal: boolean): Promise<void> {
        await this.settingsAction(async () => {
            await this.ensureClient().resolve(address, useLocal);
            await this.summary();
        });
    }

    async parked(send: boolean): Promise<void> {
        await this.settingsAction(async () => {
            const client = this.ensureClient();
            const generation = readActivityConsent()?.generation;
            if (!generation) return;
            for (const sourceId of await this.sourceIds()) {
                if (!send) await this.adapter?.keepLocal(this.raw, sourceId);
                for (const { address, record } of await client.store.entries(
                    sourceId
                )) {
                    if (
                        !record.pending.length ||
                        address.sourceIncarnation !==
                            client.contexts.get(sourceId)?.sourceIncarnation
                    )
                        continue;
                    if (!send) await client.resolve(address, false);
                    else
                        await client.store.mutate(address, (current) => ({
                            ...current!,
                            pending: current!.pending.map((p) => ({
                                ...p,
                                consentGeneration: generation,
                                deliveryLease: undefined,
                            })),
                        }));
                }
            }
            await client.flush();
            await this.summary();
        });
    }

    private async settingsAction(action: () => Promise<void>): Promise<void> {
        this.busy.set(true);
        this.error.set(false);
        try {
            await action();
        } catch {
            this.error.set(true);
        } finally {
            this.busy.set(false);
        }
    }

    async exportPositions(
        sourceId: string,
        local: PlaybackPositionData[]
    ): Promise<PlaybackPositionData[]> {
        this.ensureClient();
        return this.adapter!.exportPositions(sourceId, local);
    }

    async previewImport(): Promise<
        { sourceId: string; items: PlaybackPositionData[] }[]
    > {
        const preview = [];
        for (const sourceId of await this.sourceIds()) {
            const items = await this.raw.getAllPlaybackPositions(sourceId);
            preview.push({ sourceId, items });
        }
        return preview;
    }

    async importPositions(
        preview: { sourceId: string; items: PlaybackPositionData[] }[]
    ): Promise<number> {
        let unresolved = 0;
        for (const source of preview)
            for (const position of source.items) {
                try {
                    await this.ensureClient().importPosition(
                        source.sourceId,
                        position
                    );
                } catch {
                    unresolved++;
                }
            }
        await this.summary();
        return unresolved;
    }

    private ensureClient(): ActivitySyncClient {
        if (!this.client) {
            const created = createActivityRuntimeClient(
                this.capabilities,
                this.positionsBridge,
                {
                    changed: () => {
                        void this.summary().catch(() =>
                            this.state.set('offline')
                        );
                        announceActivityChange();
                    },
                    status: (value) => {
                        if (this.enabled()) this.state.set(value);
                    },
                }
            );
            this.client = created.client;
            this.adapter = created.adapter;
        }
        return this.client;
    }

    private async refreshSources(): Promise<void> {
        try {
            const client = this.ensureClient();
            const sourceIds = await this.sourceIds();
            for (const cached of client.contexts.keys())
                if (!sourceIds.includes(cached)) client.contexts.delete(cached);
            for (const sourceId of sourceIds) await client.refresh(sourceId);
            await this.summary();
            announceActivityChange();
        } catch {
            this.state.set('offline');
        }
    }

    private async sourceIds(): Promise<string[]> {
        return (await firstValueFrom(this.playlists.getAllPlaylists()))
            .filter((p) => p.serverUrl || p.portalUrl || p.macAddress)
            .map((p) => p._id);
    }

    private async summary(): Promise<void> {
        if (!this.client) return;
        const entries = (
            await Promise.all(
                (await this.sourceIds()).map((id) =>
                    this.client!.store.entries(id)
                )
            )
        )
            .reduce((all, group) => all.concat(group), [])
            .filter(
                (entry) =>
                    entry.address.sourceIncarnation ===
                    this.client!.contexts.get(entry.address.sourceId)
                        ?.sourceIncarnation
            );
        this.pending.set(
            entries.reduce(
                (count, entry) => count + entry.record.pending.length,
                0
            )
        );
        this.conflicts.set(
            entries.filter(
                (entry) =>
                    !!entry.record.conflict &&
                    entry.address.sourceIncarnation ===
                        this.client!.contexts.get(entry.address.sourceId)
                            ?.sourceIncarnation
            )
        );
        if (
            this.enabled() &&
            !this.pending() &&
            !this.conflicts().length &&
            this.state() !== 'offline'
        ) {
            this.state.set('ready');
            this.lastSync.set(new Date());
        }
    }
}
