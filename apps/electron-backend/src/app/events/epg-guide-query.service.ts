import { and, inArray, sql, type SQL } from 'drizzle-orm';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';
import { epgLogger } from '../util/epg-logger';
import { epgQueryService, EpgQueryService } from './epg-query.service';

/** The renderer splits larger batches; anything beyond this is dropped. */
export const EPG_GUIDE_MAX_CHANNELS_PER_REQUEST = 100;

/** Largest |ms| `Date` can serialize; a corrupt payload must not throw in SQL. */
const MAX_SERIALIZABLE_MS = 8.64e15;

export interface EpgGuideWindowRequest {
    channelIds: string[];
    /** Provider-clock instants (the renderer removes the display offset). */
    fromMs: number;
    toMs: number;
    sourceUrls?: string[];
}

export interface NormalizedGuideWindow {
    channelIds: string[];
    fromIso: string;
    toIso: string;
    sourceUrls: string[];
}

interface GuideProgramRow {
    channelId: string;
    start: string;
    stop: string;
    title: string;
    description: string | null;
    category: string | null;
    iconUrl: string | null;
    rating: string | null;
    episodeNum: string | null;
}

type ChannelResolver = Pick<EpgQueryService, 'getChannelMetadata'>;

function isUsableInstant(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= MAX_SERIALIZABLE_MS
    );
}

/** Validates and trims a request; `null` means "nothing to query". */
export function normalizeGuideWindow(
    request: EpgGuideWindowRequest
): NormalizedGuideWindow | null {
    if (
        !isUsableInstant(request.fromMs) ||
        !isUsableInstant(request.toMs) ||
        request.fromMs >= request.toMs ||
        !Array.isArray(request.channelIds)
    ) {
        return null;
    }
    const channelIds = Array.from(
        new Set(
            request.channelIds
                .map((id) => (typeof id === 'string' ? id.trim() : ''))
                .filter((id) => id.length > 0)
        )
    ).slice(0, EPG_GUIDE_MAX_CHANNELS_PER_REQUEST);
    if (channelIds.length === 0) {
        return null;
    }
    const sourceUrls = Array.from(
        new Set(
            (request.sourceUrls ?? [])
                .map((url) => url.trim())
                .filter((url) => url.length > 0)
        )
    );
    return {
        channelIds,
        fromIso: new Date(request.fromMs).toISOString(),
        toIso: new Date(request.toMs).toISOString(),
        sourceUrls,
    };
}

/**
 * Programme-guide reads for a batch of playlist channel keys: every programme
 * overlapping a time window, and which keys have any programme in it at all.
 * Keys resolve to XMLTV channel ids through the same metadata lookup the
 * sidebar uses (exact id, case-insensitive id, display name); manual mappings
 * are applied by the IPC layer before the keys reach this service.
 */
export class EpgGuideQueryService {
    constructor(
        private readonly resolver: ChannelResolver = epgQueryService,
        private readonly loggerLabel = '[EPG Guide]'
    ) {}

    async getProgramsForChannels(
        request: EpgGuideWindowRequest
    ): Promise<Record<string, EpgProgram[]>> {
        const result = this.emptyResult(request.channelIds);
        const window = normalizeGuideWindow(request);
        if (!window) {
            return result;
        }
        try {
            const resolved = await this.resolveChannelIds(window);
            const epgIds = Array.from(new Set(resolved.values()));
            if (epgIds.length === 0) {
                return result;
            }
            const db = await getDatabase();
            const rows: GuideProgramRow[] = await db
                .select({
                    channelId: schema.epgPrograms.channelId,
                    start: schema.epgPrograms.start,
                    stop: schema.epgPrograms.stop,
                    title: schema.epgPrograms.title,
                    description: schema.epgPrograms.description,
                    category: schema.epgPrograms.category,
                    iconUrl: schema.epgPrograms.iconUrl,
                    rating: schema.epgPrograms.rating,
                    episodeNum: schema.epgPrograms.episodeNum,
                })
                .from(schema.epgPrograms)
                .where(this.windowCondition(epgIds, window))
                .orderBy(schema.epgPrograms.start);
            const byEpgId = this.groupPrograms(rows);
            for (const [requestedId, epgId] of resolved) {
                result[requestedId] = byEpgId.get(epgId) ?? [];
            }
        } catch (error) {
            epgLogger.error(
                this.loggerLabel,
                'Error loading guide programmes:',
                error
            );
        }
        return result;
    }

    async getProgramCoverage(
        request: EpgGuideWindowRequest
    ): Promise<string[]> {
        const window = normalizeGuideWindow(request);
        if (!window) {
            return [];
        }
        try {
            const resolved = await this.resolveChannelIds(window);
            const epgIds = Array.from(new Set(resolved.values()));
            if (epgIds.length === 0) {
                return [];
            }
            const db = await getDatabase();
            const rows: Array<{ channelId: string }> = await db
                .selectDistinct({ channelId: schema.epgPrograms.channelId })
                .from(schema.epgPrograms)
                .where(this.windowCondition(epgIds, window));
            const covered = new Set(rows.map((row) => row.channelId));
            return window.channelIds.filter((requestedId) => {
                const epgId = resolved.get(requestedId);
                return epgId !== undefined && covered.has(epgId);
            });
        } catch (error) {
            epgLogger.error(
                this.loggerLabel,
                'Error loading guide coverage:',
                error
            );
            return [];
        }
    }

    private emptyResult(channelIds: string[]): Record<string, EpgProgram[]> {
        const result: Record<string, EpgProgram[]> = {};
        for (const id of Array.isArray(channelIds) ? channelIds : []) {
            if (typeof id === 'string' && id.trim().length > 0) {
                result[id.trim()] = [];
            }
        }
        return result;
    }

    /** requested key → XMLTV channel id (keys without a match are absent). */
    private async resolveChannelIds(
        window: NormalizedGuideWindow
    ): Promise<Map<string, string>> {
        const metadata = await this.resolver.getChannelMetadata(
            window.channelIds,
            window.sourceUrls.length > 0
                ? { sourceUrls: window.sourceUrls }
                : {}
        );
        const resolved = new Map<string, string>();
        for (const requestedId of window.channelIds) {
            const epgId = metadata[requestedId]?.id;
            if (epgId) {
                resolved.set(requestedId, epgId);
            }
        }
        return resolved;
    }

    /**
     * Overlap test in SQLite `datetime()` so provider-local offsets in the
     * stored ISO strings compare correctly against the UTC window bounds.
     */
    private windowCondition(
        epgIds: string[],
        window: NormalizedGuideWindow
    ): SQL {
        const overlap = and(
            inArray(schema.epgPrograms.channelId, epgIds),
            sql`datetime(${schema.epgPrograms.start}) < datetime(${window.toIso})`,
            sql`datetime(${schema.epgPrograms.stop}) > datetime(${window.fromIso})`
        ) as SQL;
        if (window.sourceUrls.length === 0) {
            return overlap;
        }
        return and(
            overlap,
            inArray(schema.epgPrograms.sourceUrl, window.sourceUrls)
        ) as SQL;
    }

    /** Group by channel and collapse duplicate slots (same start + title). */
    private groupPrograms(rows: GuideProgramRow[]): Map<string, EpgProgram[]> {
        const grouped = new Map<string, EpgProgram[]>();
        const seen = new Set<string>();
        for (const row of rows) {
            const key = `${row.channelId}|${row.start}|${row.title}`;
            if (seen.has(key) || !row.start || !row.stop || !row.title) {
                continue;
            }
            seen.add(key);
            const list = grouped.get(row.channelId) ?? [];
            list.push({
                start: row.start,
                stop: row.stop,
                channel: row.channelId,
                title: row.title,
                desc: row.description,
                category: row.category,
                iconUrl: row.iconUrl,
                rating: row.rating,
                episodeNum: row.episodeNum,
            });
            grouped.set(row.channelId, list);
        }
        return grouped;
    }
}

export const epgGuideQueryService = new EpgGuideQueryService();
