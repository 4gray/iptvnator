import { inject, Injectable } from '@angular/core';
import {
    type ElectronBridgeEpgLookupOptions,
    EpgItem,
    EpgProgram,
    epgProviderClockMs,
} from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import {
    EpgPreferencesService,
    EpgSourceSettingsService,
    SettingsStore,
} from '@iptvnator/services';

type ElectronEpgBridge = {
    getChannelPrograms?: (
        channelId: string,
        options: ElectronBridgeEpgLookupOptions
    ) => Promise<EpgProgram[]>;
    getCurrentProgramsBatch?: (
        channelIds: string[],
        options?: { nowMs?: number }
    ) => Promise<Record<string, EpgProgram | null>>;
    getEpgChannelMetadata?: (
        ids: string[],
        options?: { sourceUrls?: string[] }
    ) => Promise<Record<string, { id: string; displayName: string } | null>>;
    getEpgChannels?: () => Promise<{ channels: Array<{ id: string; displayName: string }> }>;
};

@Injectable({ providedIn: 'root' })
export class XtreamXmltvFallbackService {
    private readonly logger = createLogger('XtreamXmltvFallback');
    private readonly settingsStore = inject(SettingsStore);
    private readonly sources = inject(EpgSourceSettingsService);
    private readonly preferences = inject(EpgPreferencesService);
    private channelNameIndexRevision = -1;
    private channelNameIndex: Map<string, Set<string>> | null = null;
    private pendingChannelNameIndex:
        | { revision: number; promise: Promise<Map<string, Set<string>>> }
        | null = null;

    /**
     * `DataService.isElectron` is intentionally not consulted here: it
     * checks `window.process?.type`, which contextBridge isolation hides
     * from the renderer. Each method below gates on the specific bridge
     * function it needs, so a partial preload (e.g. `getChannelPrograms`
     * present but `getCurrentProgramsBatch` missing) only disables the
     * affected path.
     */
    private get bridge(): ElectronEpgBridge | null {
        if (typeof window === 'undefined') return null;
        const candidate = (
            window as unknown as { electron?: ElectronEpgBridge }
        ).electron;
        return candidate ?? null;
    }

    /**
     * Returns the full schedule for a channel from local XMLTV, mapped into
     * the `EpgItem` shape the Xtream UI consumes. Returns `[]` when nothing
     * is found or the bridge function is unavailable.
     */
    async getProgramsForChannel(
        epgChannelId: string | null | undefined,
        archiveDays?: number
    ): Promise<EpgItem[]> {
        if (!this.preferences.enabled()) return [];
        const revision = this.sources.revision();
        const id = (epgChannelId ?? '').trim();
        if (!id) return [];

        const fn = this.bridge?.getChannelPrograms;
        if (typeof fn !== 'function') return [];

        const programs = await fn.call(this.bridge, id, {
            ...this.clock,
            archiveDays,
            rejectOnError: true,
        });
        const { mapEpgProgramToEpgItem } =
            await import('./xtream-xmltv-program.util');
        if (revision !== this.sources.revision()) return [];
        return programs.map((p) => mapEpgProgramToEpgItem(p, id));
    }

    /** Query options for the provider's EPG clock. */
    private get clock(): { nowMs: number } {
        return {
            nowMs: epgProviderClockMs(
                Date.now(),
                this.settingsStore.resolvedEpgOffsetMinutes()
            ),
        };
    }

    async getCurrentProgramsBatch(
        epgChannelIds: ReadonlyArray<string | null | undefined>
    ): Promise<Record<string, EpgItem>> {
        if (!this.preferences.enabled()) return {};
        const revision = this.sources.revision();
        const fn = this.bridge?.getCurrentProgramsBatch;
        if (typeof fn !== 'function') return {};

        const ids = [
            ...new Set(
                epgChannelIds.map((id) => (id ?? '').trim()).filter(Boolean)
            ),
        ];
        if (ids.length === 0) return {};

        try {
            const rows = await fn.call(this.bridge, ids, this.clock);
            const { mapEpgProgramToEpgItem } =
                await import('./xtream-xmltv-program.util');
            if (revision !== this.sources.revision()) return {};
            const out: Record<string, EpgItem> = {};
            for (const id of ids) {
                const row = rows?.[id];
                if (row) {
                    out[id] = mapEpgProgramToEpgItem(row, id);
                }
            }
            return out;
        } catch (error) {
            this.logger.error(
                'Failed to load XMLTV current-programs batch',
                error
            );
            return {};
        }
    }

    /** Resolve candidate XMLTV IDs using the existing channel metadata index. */
    async findChannelIdsByName(
        names: ReadonlyArray<string | null | undefined>
    ): Promise<Record<string, string | null>> {
        if (!this.preferences.enabled()) return {};
        const revision = this.sources.revision();
        const fn = this.bridge?.getEpgChannels;
        if (typeof fn !== 'function') return {};
        const rawNames = [...new Set(names.map((name) => (name ?? '').trim()).filter(Boolean))];
        const keys = [...new Set(rawNames.map(normalizeEpgName).filter(Boolean))];
        if (!keys.length) return {};
        try {
            const index = await this.getChannelNameIndex(revision, fn);
            if (revision !== this.sources.revision()) return {};
            const result: Record<string, string | null> = {};
            for (const key of keys) {
                const ids = index.get(key);
                result[key] = ids?.size === 1 ? [...ids][0] : null;
            }
            return result;
        } catch (error) {
            this.logger.error('Failed to resolve XMLTV channel names', error);
            return {};
        }
    }

    private getChannelNameIndex(
        revision: number,
        fn: NonNullable<ElectronEpgBridge['getEpgChannels']>
    ): Promise<Map<string, Set<string>>> {
        if (
            this.channelNameIndexRevision === revision &&
            this.channelNameIndex
        ) {
            return Promise.resolve(this.channelNameIndex);
        }
        if (this.pendingChannelNameIndex?.revision === revision) {
            return this.pendingChannelNameIndex.promise;
        }

        const pending = fn.call(this.bridge).then((rows) => {
            const index = new Map<string, Set<string>>();
            for (const row of rows?.channels ?? []) {
                const key = normalizeEpgName(row.displayName);
                if (!key) continue;
                const ids = index.get(key) ?? new Set<string>();
                ids.add(row.id);
                index.set(key, ids);
            }
            if (revision === this.sources.revision()) {
                this.channelNameIndex = index;
                this.channelNameIndexRevision = revision;
            }
            return index;
        });
        this.pendingChannelNameIndex = { revision, promise: pending };
        const clearPending = () => {
            if (this.pendingChannelNameIndex?.promise === pending) {
                this.pendingChannelNameIndex = null;
            }
        };
        void pending.then(clearPending, clearPending);
        return pending;
    }

    /**
     * Resolve EPG for a single channel under the user's source-priority
     * setting. The Xtream provider's call is supplied by the caller via
     * `fetchProvider` so this service stays unaware of credentials. When
     * `preferUploaded` is true and XMLTV has data, the provider is not
     * called at all.
     */
    async resolveCurrentEpg(args: {
        epgChannelId: string | null | undefined;
        preferUploaded: boolean;
        archiveDays?: number;
        fetchProvider: () => Promise<EpgItem[]>;
        signal?: AbortSignal;
    }): Promise<EpgItem[]> {
        args.signal?.throwIfAborted();
        const id = (args.epgChannelId ?? '').trim();

        if (!id) return args.fetchProvider();
        const readXmltv = () => {
            args.signal?.throwIfAborted();
            return this.getProgramsForChannel(id, args.archiveDays);
        };

        const primary = args.preferUploaded ? readXmltv : args.fetchProvider;
        const fallback = args.preferUploaded ? args.fetchProvider : readXmltv;

        try {
            const programs = await primary();
            if (programs.length) return programs;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError')
                throw error;
            const programs = await fallback();
            if (!programs.length) throw error;
            return programs;
        }
        return fallback();
    }
}

function normalizeEpgName(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/\b(?:hd|fhd|uhd|4k)\b/gi, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}
