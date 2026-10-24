import { inject, Injectable } from '@angular/core';
import {
    EpgItem,
    EpgProgram,
    epgProviderClockMs,
    DEFAULT_EPG_MATCH_ORDER,
    createXmltvIdentityIndex,
    resolveOrderedXmltvId,
    collectAmbiguousXmltvIds,
    resolveUniqueActiveDuplicateNames,
} from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import { EpgSourceSettingsService, SettingsStore } from '@iptvnator/services';

type ElectronEpgBridge = {
    getEpgChannels?: () => Promise<{ channels: Array<{ id: string; displayName: string }> }>;
    getEpgProgramCoverage?: (window: {
        channelIds: string[];
        fromMs: number;
        toMs: number;
    }) => Promise<string[]>;
    getChannelPrograms?: (channelId: string) => Promise<EpgProgram[]>;
    getCurrentProgramsBatch?: (
        channelIds: string[],
        options?: { nowMs?: number }
    ) => Promise<Record<string, EpgProgram | null>>;
};

@Injectable({ providedIn: 'root' })
export class XtreamXmltvFallbackService {
    private readonly logger = createLogger('XtreamXmltvFallback');
    private readonly settingsStore = inject(SettingsStore);
    private readonly sources = inject(EpgSourceSettingsService);
    private guideCache:
        | { revision: number; promise: Promise<Array<{ id: string; displayName: string }>> }
        | undefined;
    // A single, bounded coverage query per XMLTV import revision and minute,
    // shared across all visible Xtream rows. Never issue an IPC call per row.
    private duplicateCoverageCache:
        | { revision: number; minute: number; promise: Promise<Map<string, string>> }
        | undefined;

    private async activeDuplicateNames(
        guide: readonly { id: string; displayName: string }[],
        revision: number
    ): Promise<Map<string, string>> {
        const bridge = this.bridge;
        if (!bridge?.getEpgProgramCoverage) return new Map();
        const ids = collectAmbiguousXmltvIds(guide);
        if (ids.length === 0 || ids.length > 2000) return new Map();

        const now = epgProviderClockMs(
            Date.now(),
            this.settingsStore.resolvedEpgOffsetMinutes()
        );
        const minute = Math.floor(now / 60_000);
        if (!this.duplicateCoverageCache ||
            this.duplicateCoverageCache.revision !== revision ||
            this.duplicateCoverageCache.minute !== minute) {
            this.duplicateCoverageCache = {
                revision,
                minute,
                promise: bridge.getEpgProgramCoverage({
                    channelIds: ids,
                    fromMs: now,
                    toMs: now + 1000,
                }).then((active) =>
                    resolveUniqueActiveDuplicateNames(guide, new Set(active ?? []))
                ).catch(() => new Map()),
            };
        }
        return this.duplicateCoverageCache.promise;
    }

    /**
     * Xtream providers may use IDs from an unrelated EPG. Resolve a unique
     * exact XMLTV display name without changing provider data or storing a
     * synthetic manual mapping. An existing imported-guide ID always wins.
     */
    async resolveExactXmltvChannelId(
        providerId: string | null | undefined,
        channelName: string | null | undefined
    ): Promise<string | null> {
        const original = providerId?.trim() || null;
        const name = channelName?.trim() || '';
        if ((!name && !original) || !this.bridge?.getEpgChannels) {
            return original;
        }

        const revision = this.sources.revision();
        if (!this.guideCache || this.guideCache.revision !== revision) {
            this.guideCache = {
                revision,
                promise: this.bridge.getEpgChannels()
                    .then((result) => result?.channels ?? [])
                    .catch(() => []),
            };
        }
        const guide = await this.guideCache.promise;
        if (revision !== this.sources.revision()) return original;
        const index = createXmltvIdentityIndex(guide);
        const order = this.settingsStore.resolvedEpgMatchOrder?.() ??
            DEFAULT_EPG_MATCH_ORDER;
        // Existing valid IDs take precedence when the user explicitly
        // selects "tvg-id" first. Otherwise a duplicate name may be matched
        // only if exactly one candidate is currently broadcasting.
        if (order[0] === 'tvg-id' && original &&
            index.ids.has(original.toLowerCase())) {
            return original;
        }

        let names = index.names;
        if (name && index.names.get(name.toLowerCase()) === null) {
            const unique = await this.activeDuplicateNames(guide, revision);
            if (revision !== this.sources.revision()) return original;
            const selectedId = unique.get(name.toLowerCase());
            if (selectedId) {
                names = new Map(index.names);
                names.set(name.toLowerCase(), selectedId);
            }
        }
        return resolveOrderedXmltvId(
            { channelName: name, tvgName: name, tvgId: original },
            index.ids,
            names,
            order
        ) ?? original;
    }

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
        epgChannelId: string | null | undefined
    ): Promise<EpgItem[]> {
        const revision = this.sources.revision();
        const id = (epgChannelId ?? '').trim();
        if (!id) return [];

        const fn = this.bridge?.getChannelPrograms;
        if (typeof fn !== 'function') return [];

        try {
            const programs = await fn.call(this.bridge, id);
            if (revision !== this.sources.revision()) return [];
            return (programs ?? []).map((p) => mapEpgProgramToEpgItem(p, id));
        } catch (error) {
            this.logger.error(`Failed to load XMLTV programs for ${id}`, error);
            return [];
        }
    }

    async getCurrentProgramsBatch(
        epgChannelIds: ReadonlyArray<string | null | undefined>
    ): Promise<Record<string, EpgItem>> {
        const revision = this.sources.revision();
        const fn = this.bridge?.getCurrentProgramsBatch;
        if (typeof fn !== 'function') return {};

        const ids = Array.from(
            new Set(
                epgChannelIds
                    .map((id) => (id ?? '').trim())
                    .filter((id): id is string => id.length > 0)
            )
        );
        if (ids.length === 0) return {};

        try {
            // "Now" in the provider's EPG clock (`epg-display-offset.util.ts`,
            // clock form), like every other current-programme lookup.
            const rows = await fn.call(this.bridge, ids, {
                nowMs: epgProviderClockMs(
                    Date.now(),
                    this.settingsStore.resolvedEpgOffsetMinutes()
                ),
            });
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
        fetchProvider: () => Promise<EpgItem[]>;
    }): Promise<EpgItem[]> {
        const id = (args.epgChannelId ?? '').trim();

        if (args.preferUploaded && id) {
            const xmltv = await this.getProgramsForChannel(id);
            if (xmltv.length > 0) return xmltv;
            return args.fetchProvider();
        }

        const provider = await args.fetchProvider();
        if (provider.length > 0 || !id) return provider;
        return this.getProgramsForChannel(id);
    }
}

function mapEpgProgramToEpgItem(
    program: EpgProgram,
    channelId: string
): EpgItem {
    const startMs = program.startTimestamp
        ? program.startTimestamp * 1000
        : Date.parse(program.start);
    const stopMs = program.stopTimestamp
        ? program.stopTimestamp * 1000
        : Date.parse(program.stop);
    const startTimestamp = Number.isFinite(startMs)
        ? Math.floor(startMs / 1000)
        : 0;
    const stopTimestamp = Number.isFinite(stopMs)
        ? Math.floor(stopMs / 1000)
        : 0;

    return {
        id: `${channelId}|${program.start}`,
        epg_id: '',
        title: program.title ?? '',
        lang: '',
        start: program.start,
        end: program.stop,
        stop: program.stop,
        description: program.desc ?? '',
        channel_id: channelId,
        start_timestamp: String(startTimestamp),
        stop_timestamp: String(stopTimestamp),
    };
}
