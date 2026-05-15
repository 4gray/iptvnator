import { Injectable } from '@angular/core';
import { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';

type ElectronEpgBridge = {
    getChannelPrograms?: (channelId: string) => Promise<EpgProgram[]>;
    getCurrentProgramsBatch?: (
        channelIds: string[]
    ) => Promise<Record<string, EpgProgram | null>>;
};

@Injectable({ providedIn: 'root' })
export class XtreamXmltvFallbackService {
    private readonly logger = createLogger('XtreamXmltvFallback');

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
        const candidate = (window as unknown as { electron?: ElectronEpgBridge })
            .electron;
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
        const id = (epgChannelId ?? '').trim();
        if (!id) return [];

        const fn = this.bridge?.getChannelPrograms;
        if (typeof fn !== 'function') return [];

        try {
            const programs = await fn.call(this.bridge, id);
            return (programs ?? []).map((p) => mapEpgProgramToEpgItem(p, id));
        } catch (error) {
            this.logger.error(
                `Failed to load XMLTV programs for ${id}`,
                error
            );
            return [];
        }
    }

    async getCurrentProgramsBatch(
        epgChannelIds: ReadonlyArray<string | null | undefined>
    ): Promise<Record<string, EpgItem>> {
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
            const rows = await fn.call(this.bridge, ids);
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
