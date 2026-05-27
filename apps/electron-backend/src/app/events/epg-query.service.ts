import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
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

export class EpgQueryService {
    constructor(private readonly loggerLabel = '[EPG Events]') {}

    async getChannelPrograms(channelId: string): Promise<EpgProgram[]> {
        try {
            const db = await getDatabase();
            const trimmedChannelId = channelId.trim();

            if (!trimmedChannelId) {
                return [];
            }

            let results = await db
                .select()
                .from(schema.epgPrograms)
                .where(eq(schema.epgPrograms.channelId, trimmedChannelId))
                .orderBy(schema.epgPrograms.start)
                .limit(500);

            if (results.length > 0) {
                return results
                    .map(this.transformDbRowToEpgProgram)
                    .filter(this.isValidEpgProgram);
            }

            let channel = await db
                .select()
                .from(schema.epgChannels)
                .where(
                    sql`${schema.epgChannels.id} = ${trimmedChannelId} COLLATE NOCASE`
                )
                .limit(1);

            if (channel.length > 0) {
                results = await db
                    .select()
                    .from(schema.epgPrograms)
                    .where(eq(schema.epgPrograms.channelId, channel[0].id))
                    .orderBy(schema.epgPrograms.start)
                    .limit(500);

                if (results.length > 0) {
                    return results
                        .map(this.transformDbRowToEpgProgram)
                        .filter(this.isValidEpgProgram);
                }
            }

            channel = await db
                .select()
                .from(schema.epgChannels)
                .where(eq(schema.epgChannels.displayName, trimmedChannelId))
                .limit(1);

            if (channel.length === 0) {
                channel = await db
                    .select()
                    .from(schema.epgChannels)
                    .where(
                        sql`${schema.epgChannels.displayName} = ${trimmedChannelId} COLLATE NOCASE`
                    )
                    .limit(1);
            }

            if (channel.length > 0) {
                results = await db
                    .select()
                    .from(schema.epgPrograms)
                    .where(eq(schema.epgPrograms.channelId, channel[0].id))
                    .orderBy(schema.epgPrograms.start)
                    .limit(500);

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
        channelIds: string[]
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

            const rows = await db
                .select()
                .from(schema.epgPrograms)
                .where(
                    and(
                        inArray(schema.epgPrograms.channelId, validIds),
                        lte(schema.epgPrograms.start, now),
                        gte(schema.epgPrograms.stop, now)
                    )
                );

            for (const row of rows) {
                if (!result[row.channelId]) {
                    const program = this.transformDbRowToEpgProgram(row);
                    if (this.isValidEpgProgram(program)) {
                        result[row.channelId] = program;
                    }
                }
            }

            const unmatchedIds = validIds.filter((id) => !(id in result));
            for (const channelId of unmatchedIds) {
                result[channelId] = null;

                let channel = await db
                    .select()
                    .from(schema.epgChannels)
                    .where(
                        sql`${schema.epgChannels.id} = ${channelId} COLLATE NOCASE`
                    )
                    .limit(1);

                if (channel.length === 0) {
                    channel = await db
                        .select()
                        .from(schema.epgChannels)
                        .where(
                            sql`${schema.epgChannels.displayName} = ${channelId} COLLATE NOCASE`
                        )
                        .limit(1);
                }

                if (channel.length === 0) {
                    continue;
                }

                const programRows = await db
                    .select()
                    .from(schema.epgPrograms)
                    .where(
                        and(
                            eq(schema.epgPrograms.channelId, channel[0].id),
                            lte(schema.epgPrograms.start, now),
                            gte(schema.epgPrograms.stop, now)
                        )
                    )
                    .limit(1);

                if (programRows.length > 0) {
                    const program = this.transformDbRowToEpgProgram(
                        programRows[0]
                    );
                    if (this.isValidEpgProgram(program)) {
                        result[channelId] = program;
                    }
                }
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
        channelIds: string[]
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        try {
            const normalizedChannelIds =
                this.normalizeChannelLookupKeys(channelIds);

            if (normalizedChannelIds.length === 0) {
                return {};
            }

            const db = await getDatabase();
            const lowerKeys = Array.from(
                new Set(
                    normalizedChannelIds.map((channelId) =>
                        channelId.toLowerCase()
                    )
                )
            );
            const lowerKeyValues = lowerKeys.map((key) => sql`${key}`);

            const candidates = await db
                .select({
                    id: schema.epgChannels.id,
                    displayName: schema.epgChannels.displayName,
                    iconUrl: schema.epgChannels.iconUrl,
                })
                .from(schema.epgChannels).where(sql`
                    LOWER(${schema.epgChannels.id}) IN (${sql.join(lowerKeyValues, sql`, `)})
                    OR LOWER(${schema.epgChannels.displayName}) IN (${sql.join(lowerKeyValues, sql`, `)})
                `);

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
