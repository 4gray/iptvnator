import {
    and,
    eq,
    gte,
    inArray,
    isNull,
    lte,
    or,
    sql,
    type SQL,
} from 'drizzle-orm';
import { EpgChannelMetadata, EpgProgram } from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';

interface EpgProgramRow {
    id: number;
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

type EpgDatabase = Awaited<ReturnType<typeof getDatabase>>;
type EpgChannelRow = typeof schema.epgChannels.$inferSelect;

export class EpgQueryService {
    constructor(private readonly loggerLabel = '[EPG Events]') {}

    async getChannelPrograms(
        channelId: string,
        options: { sourceUrls?: string[] } = {}
    ): Promise<EpgProgram[]> {
        try {
            const db = await getDatabase();
            const trimmedChannelId = channelId.trim();
            const sourceUrls = this.normalizeSourceUrls(options.sourceUrls);

            if (!trimmedChannelId) {
                return [];
            }

            let results = await this.selectChannelPrograms(
                db,
                trimmedChannelId,
                sourceUrls
            );
            if (results.length === 0) {
                results = await this.selectLegacyChannelPrograms(
                    db,
                    trimmedChannelId,
                    sourceUrls
                );
            }

            if (results.length > 0) {
                return results
                    .map(this.transformDbRowToEpgProgram)
                    .filter(this.isValidEpgProgram);
            }

            let channel = await this.selectChannelById(
                db,
                trimmedChannelId,
                sourceUrls
            );
            if (channel.length === 0) {
                channel = await this.selectLegacyChannelById(
                    db,
                    trimmedChannelId,
                    sourceUrls
                );
            }

            if (channel.length > 0) {
                results = await this.selectChannelPrograms(
                    db,
                    channel[0].id,
                    sourceUrls
                );
                if (results.length === 0) {
                    results = await this.selectLegacyChannelPrograms(
                        db,
                        channel[0].id,
                        sourceUrls
                    );
                }

                if (results.length > 0) {
                    return results
                        .map(this.transformDbRowToEpgProgram)
                        .filter(this.isValidEpgProgram);
                }
            }

            channel = await this.selectChannelByDisplayName(
                db,
                trimmedChannelId,
                sourceUrls
            );

            if (channel.length === 0) {
                channel = await this.selectChannelByDisplayName(
                    db,
                    trimmedChannelId,
                    sourceUrls,
                    { caseInsensitive: true }
                );
            }

            if (channel.length === 0) {
                channel = await this.selectLegacyChannelByDisplayName(
                    db,
                    trimmedChannelId,
                    sourceUrls
                );
            }

            if (channel.length === 0) {
                channel = await this.selectLegacyChannelByDisplayName(
                    db,
                    trimmedChannelId,
                    sourceUrls,
                    { caseInsensitive: true }
                );
            }

            if (channel.length > 0) {
                results = await this.selectChannelPrograms(
                    db,
                    channel[0].id,
                    sourceUrls
                );
                if (results.length === 0) {
                    results = await this.selectLegacyChannelPrograms(
                        db,
                        channel[0].id,
                        sourceUrls
                    );
                }

                return results
                    .map(this.transformDbRowToEpgProgram)
                    .filter(this.isValidEpgProgram);
            }

            return [];
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error getting channel programs:',
                error
            );
            return [];
        }
    }

    async getCurrentProgramsBatch(
        channelIds: string[],
        options: { sourceUrls?: string[] } = {}
    ): Promise<Record<string, EpgProgram | null>> {
        const result: Record<string, EpgProgram | null> = {};
        if (!Array.isArray(channelIds) || channelIds.length === 0) {
            return result;
        }

        const validIds = Array.from(
            new Set(
                channelIds
                    .map((id) => id?.trim())
                    .filter((id): id is string => Boolean(id))
            )
        );
        if (validIds.length === 0) {
            return result;
        }

        try {
            const db = await getDatabase();
            const now = new Date().toISOString();
            const sourceUrls = this.normalizeSourceUrls(options.sourceUrls);

            this.assignCurrentProgramRows(
                result,
                await this.selectCurrentProgramsForChannelIds(
                    db,
                    validIds,
                    now,
                    sourceUrls
                )
            );

            let unmatchedIds = validIds.filter((id) => !(id in result));
            if (unmatchedIds.length > 0) {
                this.assignCurrentProgramRows(
                    result,
                    await this.selectCurrentProgramsForChannelIds(
                        db,
                        unmatchedIds,
                        now,
                        sourceUrls,
                        { legacyOnly: true }
                    )
                );
            }

            unmatchedIds = validIds.filter((id) => !(id in result));
            if (unmatchedIds.length > 0) {
                const scopedCandidates = await this.selectChannelLookupCandidates(
                    db,
                    unmatchedIds,
                    sourceUrls
                );
                const unresolvedIds = unmatchedIds.filter(
                    (channelId) =>
                        !this.resolveChannelMetadataCandidate(
                            channelId,
                            scopedCandidates
                        )
                );
                const candidates =
                    unresolvedIds.length > 0
                        ? [
                              ...scopedCandidates,
                              ...(await this.selectChannelLookupCandidates(
                                  db,
                                  unresolvedIds,
                                  sourceUrls,
                                  { legacyOnly: true }
                              )),
                          ]
                        : scopedCandidates;
                const candidateIdsByRequestedId = new Map<string, string>();
                for (const channelId of unmatchedIds) {
                    const candidate = this.resolveChannelMetadataCandidate(
                        channelId,
                        candidates
                    );
                    if (candidate) {
                        candidateIdsByRequestedId.set(channelId, candidate.id);
                    }
                }

                const candidateIds = Array.from(
                    new Set(candidateIdsByRequestedId.values())
                );
                const matchedCandidateIds =
                    this.assignCandidateCurrentProgramRows(
                        result,
                        candidateIdsByRequestedId,
                        await this.selectCurrentProgramsForChannelIds(
                            db,
                            candidateIds,
                            now,
                            sourceUrls
                        )
                    );
                const unresolvedCandidateIds = candidateIds.filter(
                    (candidateId) => !matchedCandidateIds.has(candidateId)
                );
                this.assignCandidateCurrentProgramRows(
                    result,
                    candidateIdsByRequestedId,
                    await this.selectCurrentProgramsForChannelIds(
                        db,
                        unresolvedCandidateIds,
                        now,
                        sourceUrls,
                        { legacyOnly: true }
                    )
                );
            }

            for (const channelId of validIds) {
                result[channelId] ??= null;
            }
            return result;
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error getting batch current programs:',
                error
            );
            return result;
        }
    }

    async getAllChannels(): Promise<{
        channels: Array<{ id: string; displayName: string }>;
        programs: never[];
    }> {
        try {
            const db = await getDatabase();
            const channels = await db
                .select({
                    id: schema.epgChannels.id,
                    displayName: schema.epgChannels.displayName,
                })
                .from(schema.epgChannels)
                .orderBy(schema.epgChannels.displayName);

            return { channels, programs: [] };
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error getting all channels:',
                error
            );
            return { channels: [], programs: [] };
        }
    }

    async getChannelMetadata(
        channelIds: string[],
        options: { sourceUrls?: string[] } = {}
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        try {
            const normalizedChannelIds =
                this.normalizeChannelLookupKeys(channelIds);

            if (normalizedChannelIds.length === 0) {
                return {};
            }

            const db = await getDatabase();
            const sourceUrls = this.normalizeSourceUrls(options.sourceUrls);
            const lowerKeys = Array.from(
                new Set(
                    normalizedChannelIds.map((channelId) =>
                        channelId.toLowerCase()
                    )
                )
            );
            const lowerKeyValues = lowerKeys.map((key) => sql`${key}`);
            let candidates = await this.selectChannelMetadataCandidates(
                db,
                lowerKeyValues,
                sourceUrls
            );
            if (sourceUrls.length > 0) {
                const missingChannelIds = normalizedChannelIds.filter(
                    (channelId) =>
                        !this.resolveChannelMetadataCandidate(
                            channelId,
                            candidates
                        )
                );
                if (missingChannelIds.length > 0) {
                    candidates = [
                        ...candidates,
                        ...(await this.selectChannelMetadataCandidates(
                            db,
                            missingChannelIds
                                .map((channelId) => channelId.toLowerCase())
                                .map((key) => sql`${key}`),
                            sourceUrls,
                            { legacyOnly: true }
                        )),
                    ];
                }
            }

            return Object.fromEntries(
                normalizedChannelIds.map((channelId) => [
                    channelId,
                    this.resolveChannelMetadataCandidate(channelId, candidates),
                ])
            );
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error getting channel metadata:',
                error
            );
            return {};
        }
    }

    async getChannelsByRange(
        skip: number,
        limit: number
    ): Promise<
        Array<{
            id: string;
            displayName: string;
            iconUrl: string | null;
            programs: EpgProgram[];
        }>
    > {
        try {
            const db = await getDatabase();
            const channels = await db
                .select({
                    id: schema.epgChannels.id,
                    displayName: schema.epgChannels.displayName,
                    iconUrl: schema.epgChannels.iconUrl,
                })
                .from(schema.epgChannels)
                .orderBy(schema.epgChannels.displayName)
                .offset(skip)
                .limit(limit);

            return Promise.all(
                channels.map(async (channel) => {
                    const programs = await db
                        .select()
                        .from(schema.epgPrograms)
                        .where(eq(schema.epgPrograms.channelId, channel.id))
                        .orderBy(schema.epgPrograms.start);

                    return {
                        ...channel,
                        programs: programs.map(this.transformDbRowToEpgProgram),
                    };
                })
            );
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error getting channels by range:',
                error
            );
            return [];
        }
    }

    private normalizeChannelLookupKeys(channelIds: string[]): string[] {
        return Array.from(
            new Set(
                channelIds
                    .map((channelId) => channelId.trim())
                    .filter((channelId) => channelId.length > 0)
            )
        );
    }

    private normalizeSourceUrls(sourceUrls?: string[]): string[] {
        return Array.from(
            new Set(
                (sourceUrls ?? [])
                    .map((sourceUrl) => sourceUrl.trim())
                    .filter((sourceUrl) => sourceUrl.length > 0)
            )
        );
    }

    private assignCurrentProgramRows(
        result: Record<string, EpgProgram | null>,
        rows: EpgProgramRow[]
    ): Set<string> {
        const matchedChannelIds = new Set<string>();
        for (const row of rows) {
            if (result[row.channelId]) {
                continue;
            }

            const program = this.transformDbRowToEpgProgram(row);
            if (this.isValidEpgProgram(program)) {
                result[row.channelId] = program;
                matchedChannelIds.add(row.channelId);
            }
        }
        return matchedChannelIds;
    }

    private assignCandidateCurrentProgramRows(
        result: Record<string, EpgProgram | null>,
        candidateIdsByRequestedId: Map<string, string>,
        rows: EpgProgramRow[]
    ): Set<string> {
        const matchedCandidateIds = new Set<string>();
        for (const row of rows) {
            const program = this.transformDbRowToEpgProgram(row);
            if (!this.isValidEpgProgram(program)) {
                continue;
            }

            for (const [
                requestedId,
                candidateId,
            ] of candidateIdsByRequestedId) {
                if (candidateId !== row.channelId || result[requestedId]) {
                    continue;
                }

                result[requestedId] = program;
                matchedCandidateIds.add(candidateId);
            }
        }
        return matchedCandidateIds;
    }

    private async selectChannelPrograms(
        db: EpgDatabase,
        channelId: string,
        sourceUrls: string[]
    ): Promise<EpgProgramRow[]> {
        return db
            .select()
            .from(schema.epgPrograms)
            .where(
                this.withProgramSourceScope(
                    eq(schema.epgPrograms.channelId, channelId),
                    sourceUrls
                )
            )
            .orderBy(schema.epgPrograms.start)
            .limit(500);
    }

    private async selectLegacyChannelPrograms(
        db: EpgDatabase,
        channelId: string,
        sourceUrls: string[]
    ): Promise<EpgProgramRow[]> {
        if (sourceUrls.length === 0) {
            return [];
        }

        return db
            .select()
            .from(schema.epgPrograms)
            .where(
                this.withProgramSourceScope(
                    eq(schema.epgPrograms.channelId, channelId),
                    sourceUrls,
                    { legacyOnly: true }
                )
            )
            .orderBy(schema.epgPrograms.start)
            .limit(500);
    }

    private async selectCurrentProgramsForChannelIds(
        db: EpgDatabase,
        channelIds: string[],
        now: string,
        sourceUrls: string[],
        options: { legacyOnly?: boolean } = {}
    ): Promise<EpgProgramRow[]> {
        if (channelIds.length === 0) {
            return [];
        }
        if (options.legacyOnly && sourceUrls.length === 0) {
            return [];
        }

        return db
            .select()
            .from(schema.epgPrograms)
            .where(
                this.withProgramSourceScope(
                    and(
                        inArray(schema.epgPrograms.channelId, channelIds),
                        lte(schema.epgPrograms.start, now),
                        gte(schema.epgPrograms.stop, now)
                    ) as SQL,
                    sourceUrls,
                    options
                )
            )
            .limit(channelIds.length);
    }

    private async selectChannelById(
        db: EpgDatabase,
        channelId: string,
        sourceUrls: string[]
    ): Promise<EpgChannelRow[]> {
        return db
            .select()
            .from(schema.epgChannels)
            .where(
                this.withChannelSourceScope(
                    sql`${schema.epgChannels.id} = ${channelId} COLLATE NOCASE`,
                    sourceUrls
                )
            )
            .limit(1);
    }

    private async selectLegacyChannelById(
        db: EpgDatabase,
        channelId: string,
        sourceUrls: string[]
    ): Promise<EpgChannelRow[]> {
        if (sourceUrls.length === 0) {
            return [];
        }

        return db
            .select()
            .from(schema.epgChannels)
            .where(
                this.withChannelSourceScope(
                    sql`${schema.epgChannels.id} = ${channelId} COLLATE NOCASE`,
                    sourceUrls,
                    { legacyOnly: true }
                )
            )
            .limit(1);
    }

    private async selectChannelByDisplayName(
        db: EpgDatabase,
        displayName: string,
        sourceUrls: string[],
        options: { caseInsensitive?: boolean } = {}
    ): Promise<EpgChannelRow[]> {
        const condition = options.caseInsensitive
            ? (sql`${schema.epgChannels.displayName} = ${displayName} COLLATE NOCASE` as SQL)
            : eq(schema.epgChannels.displayName, displayName);

        return db
            .select()
            .from(schema.epgChannels)
            .where(
                this.withChannelSourceScope(condition, sourceUrls)
            )
            .limit(1);
    }

    private async selectLegacyChannelByDisplayName(
        db: EpgDatabase,
        displayName: string,
        sourceUrls: string[],
        options: { caseInsensitive?: boolean } = {}
    ): Promise<EpgChannelRow[]> {
        if (sourceUrls.length === 0) {
            return [];
        }

        const condition = options.caseInsensitive
            ? (sql`${schema.epgChannels.displayName} = ${displayName} COLLATE NOCASE` as SQL)
            : eq(schema.epgChannels.displayName, displayName);

        return db
            .select()
            .from(schema.epgChannels)
            .where(
                this.withChannelSourceScope(
                    condition,
                    sourceUrls,
                    { legacyOnly: true }
                )
            )
            .limit(1);
    }

    private async selectChannelLookupCandidates(
        db: EpgDatabase,
        channelIds: string[],
        sourceUrls: string[],
        options: { legacyOnly?: boolean } = {}
    ): Promise<EpgChannelMetadata[]> {
        const lowerKeyValues = Array.from(
            new Set(channelIds.map((channelId) => channelId.toLowerCase()))
        ).map((key) => sql`${key}`);

        return this.selectChannelMetadataCandidates(
            db,
            lowerKeyValues,
            sourceUrls,
            options
        );
    }

    private async selectChannelMetadataCandidates(
        db: EpgDatabase,
        lowerKeyValues: SQL[],
        sourceUrls: string[],
        options: { legacyOnly?: boolean } = {}
    ): Promise<EpgChannelMetadata[]> {
        if (options.legacyOnly && sourceUrls.length === 0) {
            return [];
        }

        const lookupCondition = sql`
            (
                LOWER(${schema.epgChannels.id}) IN (${sql.join(lowerKeyValues, sql`, `)})
                OR LOWER(${schema.epgChannels.displayName}) IN (${sql.join(lowerKeyValues, sql`, `)})
            )
        `;

        return db
            .select({
                id: schema.epgChannels.id,
                displayName: schema.epgChannels.displayName,
                iconUrl: schema.epgChannels.iconUrl,
            })
            .from(schema.epgChannels)
            .where(
                this.withChannelSourceScope(
                    lookupCondition as SQL,
                    sourceUrls,
                    options
                )
            );
    }

    private withProgramSourceScope(
        condition: SQL,
        sourceUrls: string[],
        options: { legacyOnly?: boolean } = {}
    ): SQL {
        if (options.legacyOnly) {
            return and(condition, this.legacyProgramSourceCondition()) as SQL;
        }

        return sourceUrls.length > 0
            ? (and(
                  condition,
                  inArray(schema.epgPrograms.sourceUrl, sourceUrls)
              ) as SQL)
            : condition;
    }

    private withChannelSourceScope(
        condition: SQL,
        sourceUrls: string[],
        options: { legacyOnly?: boolean } = {}
    ): SQL {
        if (options.legacyOnly) {
            return and(condition, this.legacyChannelSourceCondition()) as SQL;
        }

        return sourceUrls.length > 0
            ? (and(
                  condition,
                  or(
                      inArray(schema.epgChannels.sourceUrl, sourceUrls),
                      this.channelHasProgramsForSourceScope(sourceUrls)
                  ) as SQL
              ) as SQL)
            : condition;
    }

    private legacyProgramSourceCondition(): SQL {
        return or(
            isNull(schema.epgPrograms.sourceUrl),
            eq(schema.epgPrograms.sourceUrl, '')
        ) as SQL;
    }

    private legacyChannelSourceCondition(): SQL {
        return or(
            isNull(schema.epgChannels.sourceUrl),
            eq(schema.epgChannels.sourceUrl, '')
        ) as SQL;
    }

    private channelHasProgramsForSourceScope(sourceUrls: string[]): SQL {
        const sourceUrlValues = sourceUrls.map((sourceUrl) => sql`${sourceUrl}`);

        return sql`EXISTS (
            SELECT 1
            FROM ${schema.epgPrograms}
            WHERE ${schema.epgPrograms.channelId} = ${schema.epgChannels.id}
              AND ${schema.epgPrograms.sourceUrl} IN (${sql.join(sourceUrlValues, sql`, `)})
        )`;
    }

    private resolveChannelMetadataCandidate(
        channelId: string,
        candidates: EpgChannelMetadata[]
    ): EpgChannelMetadata | null {
        const lowerChannelId = channelId.toLowerCase();

        const exactIdMatch =
            candidates.find((candidate) => candidate.id === channelId) ?? null;
        if (exactIdMatch) {
            return exactIdMatch;
        }

        const caseInsensitiveIdMatch =
            candidates.find(
                (candidate) => candidate.id.toLowerCase() === lowerChannelId
            ) ?? null;
        if (caseInsensitiveIdMatch) {
            return caseInsensitiveIdMatch;
        }

        const exactDisplayNameMatch =
            candidates.find(
                (candidate) => candidate.displayName === channelId
            ) ?? null;
        if (exactDisplayNameMatch) {
            return exactDisplayNameMatch;
        }

        return (
            candidates.find(
                (candidate) =>
                    candidate.displayName.toLowerCase() === lowerChannelId
            ) ?? null
        );
    }

    private transformDbRowToEpgProgram(row: EpgProgramRow): EpgProgram {
        return {
            start: row.start,
            stop: row.stop,
            channel: row.channelId,
            title: row.title,
            desc: row.description,
            category: row.category,
            iconUrl: row.iconUrl,
            rating: row.rating,
            episodeNum: row.episodeNum,
        };
    }

    private isValidEpgProgram(program: EpgProgram): boolean {
        return Boolean(
            program.start &&
            program.stop &&
            !Number.isNaN(new Date(program.start).getTime()) &&
            !Number.isNaN(new Date(program.stop).getTime())
        );
    }
}

export const epgQueryService = new EpgQueryService();
