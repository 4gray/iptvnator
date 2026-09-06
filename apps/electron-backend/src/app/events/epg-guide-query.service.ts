import {
    and,
    eq,
    gt,
    inArray,
    isNull,
    lt,
    or,
    sql,
    type SQL,
} from 'drizzle-orm';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';
import { epgLogger } from '../util/epg-logger';
import {
    EpgProgramRow,
    isValidEpgProgram,
    toEpgProgramFromRow,
} from './epg-program-row.util';
import { epgQueryService, EpgQueryService } from './epg-query.service';
import {
    EPG_GUIDE_MAX_CHANNELS_PER_REQUEST,
    EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST,
    EpgGuideWindowRequest,
    NormalizedGuideWindow,
    normalizeGuideWindow,
    uniqueTrimmedStrings,
} from './epg-guide-window.util';

export {
    EPG_GUIDE_MAX_CHANNELS_PER_REQUEST,
    EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST,
    normalizeGuideWindow,
} from './epg-guide-window.util';
export type {
    EpgGuideWindowRequest,
    NormalizedGuideWindow,
} from './epg-guide-window.util';

type ChannelResolver = Pick<EpgQueryService, 'getChannelMetadata'>;

/**
 * Overlap test in SQLite `datetime()` so provider-local offsets in the
 * stored ISO strings compare correctly against the UTC window bounds.
 *
 * `datetime()` around the indexed `start`/`stop` columns is opaque to the
 * planner, which would use `idx_epg_programs_time_range` for `channel_id`
 * only and then run the function over the channel's ENTIRE retained history —
 * on a multi-week XMLTV database a 2000-key coverage probe stalls on that. So
 * the exact test is paired with plain string comparisons against the
 * slack-widened bounds (`toSlackIso`/`fromSlackIso`), which the planner CAN
 * turn into a `channel_id=? AND start<?` range scan. The slack makes that
 * prefilter a strict superset of the exact result, so it narrows the scan
 * without ever changing the answer — see `GUIDE_WINDOW_SLACK_MS` in
 * `epg-guide-window.util.ts` for why 48 h is enough.
 *
 * Unlike `EpgQueryService`, which runs a scoped query and then, on an empty
 * result, a second unscoped legacy query, this predicate is folded into a
 * SINGLE query: when `sourceUrls` is non-empty, the `WHERE` clause accepts
 * the union of rows belonging to the requested sources AND unsourced legacy
 * rows (`source_url` null or `''`) in one pass. Rows that satisfy both a
 * requested source and the legacy leg are not double-counted — identical
 * slots (same channel + start + title) are collapsed later in
 * `groupPrograms`. Legacy rows exist only for programme data imported
 * before per-source EPG tracking was added; the `source_url` backfill in
 * `libs/shared/database/src/lib/connection.ts` fills it in where it can
 * still be inferred from the owning channel, but a row it cannot attribute
 * stays unsourced permanently. In v1 the M3U host never scopes this query to
 * specific sources (it queries unscoped), so this additive behaviour only
 * matters for portal (Xtream/Stalker) hosts, which do pass `sourceUrls`.
 */
export function guideWindowCondition(
    epgIds: string[],
    window: NormalizedGuideWindow
): SQL {
    const overlap = and(
        inArray(schema.epgPrograms.channelId, epgIds),
        lt(schema.epgPrograms.start, window.toSlackIso),
        gt(schema.epgPrograms.stop, window.fromSlackIso),
        sql`datetime(${schema.epgPrograms.start}) < datetime(${window.toIso})`,
        sql`datetime(${schema.epgPrograms.stop}) > datetime(${window.fromIso})`
    ) as SQL;
    if (window.sourceUrls.length === 0) {
        return overlap;
    }
    return and(
        overlap,
        or(
            inArray(schema.epgPrograms.sourceUrl, window.sourceUrls),
            isNull(schema.epgPrograms.sourceUrl),
            eq(schema.epgPrograms.sourceUrl, '')
        ) as SQL
    ) as SQL;
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

    /**
     * Response keys are exactly the trimmed, de-duplicated, cap-respecting
     * requested keys (`window.channelIds`) — never the raw request. A key cut
     * by the per-request cap is absent from the result, never present with an
     * empty list, so a caller can tell "queried, nothing found" apart from
     * "not queried at all". An invalid window returns `{}`.
     */
    async getProgramsForChannels(
        request: EpgGuideWindowRequest
    ): Promise<Record<string, EpgProgram[]>> {
        const window = normalizeGuideWindow(
            request,
            EPG_GUIDE_MAX_CHANNELS_PER_REQUEST
        );
        if (!window) {
            return {};
        }
        this.warnIfTruncated(
            request.channelIds,
            window.channelIds,
            'programme'
        );
        const result = this.emptyResult(window.channelIds);
        try {
            const resolved = await this.resolveChannelIds(window);
            const epgIds = Array.from(new Set(resolved.values()));
            if (epgIds.length === 0) {
                return result;
            }
            const db = await getDatabase();
            const rows: EpgProgramRow[] = await db
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
                .where(guideWindowCondition(epgIds, window))
                .orderBy(schema.epgPrograms.start);
            const byEpgId = this.groupPrograms(rows);
            for (const [requestedId, epgId] of resolved) {
                // Copy so two requested keys resolving to the same channel
                // never share one array reference.
                result[requestedId] = [...(byEpgId.get(epgId) ?? [])];
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

    /**
     * Response keys are exactly the trimmed, de-duplicated, cap-respecting
     * requested keys (`window.channelIds`) — never the raw request. A key cut
     * by the per-request cap is absent from the result. An invalid window,
     * or any failure while querying, returns `[]`.
     */
    async getProgramCoverage(
        request: EpgGuideWindowRequest
    ): Promise<string[]> {
        const window = normalizeGuideWindow(
            request,
            EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST
        );
        if (!window) {
            return [];
        }
        this.warnIfTruncated(request.channelIds, window.channelIds, 'coverage');
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
                .where(guideWindowCondition(epgIds, window));
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
            // Unlike programmes, coverage must not fail soft: an empty answer
            // reads as "no channel has EPG" and the "Only with EPG" toggle
            // would hide every row. A rejection keeps coverage unknown.
            throw error;
        }
    }

    private emptyResult(channelIds: string[]): Record<string, EpgProgram[]> {
        // Null prototype: a provider key such as `__proto__` must become an
        // own property, not hit the legacy setter.
        const result: Record<string, EpgProgram[]> = Object.create(null);
        for (const id of channelIds) {
            result[id] = [];
        }
        return result;
    }

    /**
     * Logs (counts only — no channel keys or source URLs) when the per-request
     * cap dropped part of the request, so an oversized batch is visible in
     * diagnostics instead of silently losing channels. `kind` names which
     * read was truncated (programme lookup vs. coverage probe) since both
     * share this helper but log to the same channel.
     */
    private warnIfTruncated(
        requestedIds: unknown,
        keptIds: string[],
        kind: 'programme' | 'coverage'
    ): void {
        const requestedCount = uniqueTrimmedStrings(
            requestedIds,
            Number.MAX_SAFE_INTEGER
        ).length;
        if (requestedCount > keptIds.length) {
            epgLogger.log(this.loggerLabel, `Guide ${kind} request truncated`, {
                requested: requestedCount,
                kept: keptIds.length,
            });
        }
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
     * Group by channel, drop rows with an invalid/unparsable start or stop
     * (mirrors `EpgQueryService.isValidEpgProgram`), and collapse duplicate
     * slots (same start + title).
     */
    private groupPrograms(rows: EpgProgramRow[]): Map<string, EpgProgram[]> {
        const grouped = new Map<string, EpgProgram[]>();
        const seen = new Set<string>();
        for (const row of rows) {
            const key = `${row.channelId}|${row.start}|${row.title}`;
            if (seen.has(key) || !row.title) {
                continue;
            }
            const program = toEpgProgramFromRow(row);
            if (!isValidEpgProgram(program)) {
                continue;
            }
            seen.add(key);
            const list = grouped.get(row.channelId) ?? [];
            list.push(program);
            grouped.set(row.channelId, list);
        }
        return grouped;
    }
}

export const epgGuideQueryService = new EpgGuideQueryService();
