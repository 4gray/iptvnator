import { createActivityRuntimeClient } from './activity-runtime-client';
import { readActivityConsent } from './activity-consent-state';
import {
    changeActivityConsent,
    type ActivityConsentPause,
} from './activity-consent-transition';
import { announceActivityChange } from '@iptvnator/services/activity-changes';
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
import { SourceSyncService } from '@iptvnator/services/source-sync';
import { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import {
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
} from '@iptvnator/shared/interfaces';
import { activityConsentKey, activityEnabled } from './activity-consent';
import { ActivityPositionAdapter } from './activity-position-adapter';
import {
    handleParkedActivity,
    previewLocalActivity,
    importLocalActivity,
    readActivitySummary,
    type ActivityImportPreview,
} from './activity-sync-settings';

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
    private consentChange?: Promise<void>;
    private changingTo?: boolean;
    private readonly deliveryPaused = signal(false);
    private pauseOwner?: ActivityConsentPause;
    readonly enabled = signal(activityEnabled());
    readonly state = signal('disabled');
    readonly stateKey = computed(
        () =>
            ({
                disabled: 'ACTIVITY_SYNC.STATE_disabled',
                disabling: 'ACTIVITY_SYNC.STATE_disabling',
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
        this.ensureTimer();
        await this.refresh();
    }

    async setEnabled(enabled: boolean): Promise<void> {
        if (this.consentChange) {
            const target = this.changingTo;
            await this.consentChange;
            if (enabled !== target) await this.setEnabled(enabled);
            return;
        }
        if (enabled === this.enabled() && !this.isDisabling()) return;
        this.changingTo = enabled;
        const change = Promise.resolve().then(() =>
            changeActivityConsent(
                {
                    enabled: this.enabled,
                    busy: this.busy,
                    error: this.error,
                    state: this.state,
                    supportsStorage: this.capabilities.supportsActivityStorage,
                    instanceId: this.client?.options.instanceId,
                    refreshSources: () => this.sources.refresh(),
                    client: () => this.ensureClient(),
                    mirror: async () => {
                        for (const sourceId of await this.sourceIds())
                            await this.adapter!.keepLocal(this.raw, sourceId);
                    },
                    pause: (value, owner) => {
                        this.pauseOwner = value ? owner : undefined;
                        this.deliveryPaused.set(value);
                    },
                    stopTimer: () => {
                        clearInterval(this.timer);
                        this.timer = undefined;
                    },
                },
                enabled
            )
        );
        this.consentChange = change;
        try {
            await change;
        } finally {
            this.consentChange = undefined;
        }
        if (enabled && this.enabled()) await this.start();
        else if (this.enabled()) this.ensureTimer();
    }

    private isDisabling(): boolean {
        try {
            const current = readActivityConsent();
            if (
                this.deliveryPaused() &&
                this.pauseOwner &&
                (this.pauseOwner.key !== activityConsentKey() ||
                    this.pauseOwner.generation !== current?.generation)
            ) {
                this.pauseOwner = undefined;
                this.deliveryPaused.set(false);
            }
            return this.deliveryPaused() || !!current?.disabling;
        } catch {
            return true;
        }
    }

    private ensureTimer(): void {
        this.timer ??= setInterval(() => {
            if (!document.hidden) void this.refresh();
        }, 5000);
    }

    async begin(position: PlayerContentInfo, startTime = 0): Promise<void> {
        if (!this.enabled() || this.isDisabling()) return;
        try {
            await this.ensureClient().begin(position.playlistId!, {
                ...position,
                positionSeconds: startTime,
            });
        } catch {
            this.reportStorageFailure();
        }
    }

    async checkpoint(position: PlaybackPositionData): Promise<void> {
        if (!activityEnabled()) return;
        try {
            this.ensureClient();
            await this.adapter!.invoke(
                this.raw,
                'savePlaybackPosition',
                [position.playlistId!, position],
                this.isDisabling()
            );
        } catch {
            this.reportStorageFailure();
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
        if (!activityEnabled() || !ActivityPositionAdapter.handles(method))
            return Reflect.get(raw, method).apply(raw, args);
        this.ensureClient();
        try {
            return await this.adapter!.invoke(
                raw,
                method,
                args,
                this.isDisabling()
            );
        } catch (error) {
            this.reportStorageFailure();
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
            await handleParkedActivity(
                client,
                this.adapter!,
                this.raw,
                await this.sourceIds(),
                send,
                generation
            );
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

    async previewImport(): Promise<ActivityImportPreview> {
        return previewLocalActivity(this.raw, await this.sourceIds());
    }

    async importPositions(preview: ActivityImportPreview): Promise<number> {
        const unresolved = await importLocalActivity(
            this.ensureClient(),
            preview
        );
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
                        void this.summary().catch(() => {
                            if (!this.isDisabling()) this.state.set('offline');
                        });
                        announceActivityChange();
                    },
                    status: (value) => {
                        if (this.enabled() && !this.isDisabling())
                            this.state.set(value);
                    },
                },
                () => this.deliveryPaused()
            );
            this.client = created.client;
            this.adapter = created.adapter;
        }
        return this.client;
    }

    private async refreshSources(): Promise<void> {
        try {
            if (this.isDisabling()) {
                await this.setEnabled(false);
                return;
            }
            const client = this.ensureClient();
            const sourceIds = await this.sourceIds();
            for (const cached of client.contexts.keys())
                if (!sourceIds.includes(cached)) client.contexts.delete(cached);
            for (const sourceId of sourceIds) await client.refresh(sourceId);
            await this.summary();
            announceActivityChange();
        } catch {
            if (this.enabled()) this.reportStorageFailure();
        }
    }

    private reportStorageFailure(): void {
        const paused = this.isDisabling();
        this.state.set(paused ? 'disabling' : 'offline');
        if (paused) this.error.set(true);
    }

    private async sourceIds(): Promise<string[]> {
        return (await firstValueFrom(this.playlists.getAllPlaylists()))
            .filter((p) => p.serverUrl || p.portalUrl || p.macAddress)
            .map((p) => p._id);
    }

    private async summary(): Promise<void> {
        if (!this.client) return;
        const summary = await readActivitySummary(
            this.client,
            await this.sourceIds()
        );
        this.pending.set(summary.pending);
        this.conflicts.set(summary.conflicts);
        if (
            this.enabled() &&
            !this.isDisabling() &&
            !this.pending() &&
            !this.conflicts().length &&
            this.state() !== 'offline'
        ) {
            this.state.set('ready');
            this.lastSync.set(new Date());
        }
    }
}
