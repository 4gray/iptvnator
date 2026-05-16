import { app } from 'electron';
import { existsSync, statSync, createReadStream, createWriteStream } from 'fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'fs/promises';
import { IncomingMessage } from 'http';
import * as https from 'https';
import * as path from 'path';
import * as readline from 'readline';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import {
    ImdbMovieRatingMatch,
    ImdbMovieRatingRequestItem,
    ImdbMovieRatingsResponse,
} from 'shared-interfaces';

const DATASET_URLS = {
    basics: 'https://datasets.imdbws.com/title.basics.tsv.gz',
    ratings: 'https://datasets.imdbws.com/title.ratings.tsv.gz',
    akas: 'https://datasets.imdbws.com/title.akas.tsv.gz',
} as const;

const INDEX_VERSION = 2;
const MOVIE_TITLE_TYPES = new Set(['movie', 'tvMovie', 'video']);
const SERIES_TITLE_TYPES = new Set(['tvSeries', 'tvMiniSeries']);
const SUPPORTED_TITLE_TYPES = new Set([
    ...MOVIE_TITLE_TYPES,
    ...SERIES_TITLE_TYPES,
]);
const ENABLE_FULL_ALIAS_SCAN =
    process.env['IPTVNATOR_IMDB_ENABLE_FULL_ALIAS_SCAN'] === '1';
const MAX_SUGGESTION_LOOKUPS_PER_REQUEST = 25;
const MAX_SUGGESTION_QUERIES_PER_LOOKUP = 2;
// Positive IMDb rating matches intentionally have no TTL. Only negative
// "not found" entries expire so a later IMDb dataset/search update can retry.
const ALIAS_NEGATIVE_MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const LEGACY_ALIAS_CACHE_PATTERN = /^movie-rating-aliases-v\d+\.json$/;
type ImdbLookupKind = 'movie' | 'series';

interface ImdbRatingRecord {
    rating: number;
    votes: number;
}

interface ImdbTitleRecord extends ImdbRatingRecord {
    imdbId: string;
    primaryTitle: string;
    originalTitle: string;
    titleType: string;
    normalizedPrimaryTitle: string;
    normalizedOriginalTitle: string;
    year?: number;
    runtimeMinutes?: number;
}

interface ImdbTitleIndexData {
    version: number;
    builtAt: string;
    records: ImdbTitleRecord[];
    byTitle: Record<string, number[]>;
    byTitleYear: Record<string, number[]>;
}

interface ImdbTitleIndex extends ImdbTitleIndexData {
    recordIndexById: Map<string, number>;
}

interface MovieLookup {
    id: string | number;
    imdbId?: string;
    kind: ImdbLookupKind;
    normalizedTitles: string[];
    searchQueries: string[];
    year?: number;
    durationMinutes?: number;
    cacheKeys: string[];
}

interface ScoredMatch {
    match: ImdbMovieRatingMatch;
    score: number;
}

interface ImdbSuggestionItem {
    id?: string;
    l?: string;
    qid?: string;
    q?: string;
    rank?: number;
    y?: number;
}

interface ImdbSuggestionResponse {
    d?: ImdbSuggestionItem[];
}

interface ImdbAliasCacheMiss {
    miss: true;
    cachedAt: number;
}

type ImdbAliasCacheEntry = ImdbMovieRatingMatch | ImdbAliasCacheMiss;
type ImdbAliasCache = Record<string, ImdbAliasCacheEntry>;

class ImdbRatingsService {
    private indexPromise: Promise<ImdbTitleIndex> | null = null;

    async resolveMovieRatings(
        items: ImdbMovieRatingRequestItem[]
    ): Promise<ImdbMovieRatingsResponse> {
        try {
            const lookups = items
                .map((item) => this.createLookup(item))
                .filter((item): item is MovieLookup => item !== null);

            if (lookups.length === 0) {
                return {
                    status: 'ready',
                    matches: {},
                };
            }

            const aliasCache = await this.readAliasCache();
            const matches: Record<string, ImdbMovieRatingMatch> = {};
            const indexLookups: MovieLookup[] = [];
            const unresolved: MovieLookup[] = [];
            let cacheDirty = false;

            for (const lookup of lookups) {
                const cached = this.findCachedAliasMatch(lookup, aliasCache);
                if (cached) {
                    matches[String(lookup.id)] = cached;
                    continue;
                }

                if (this.hasFreshAliasMiss(lookup, aliasCache)) {
                    continue;
                }

                indexLookups.push(lookup);
            }

            if (indexLookups.length === 0) {
                return {
                    status: 'ready',
                    matches,
                };
            }

            const index = await this.loadTitleIndex();

            for (const lookup of indexLookups) {
                const directMatch = this.findBestIndexedMatch(index, lookup);

                if (directMatch) {
                    matches[String(lookup.id)] = directMatch;
                    this.writeLookupCacheEntries(
                        aliasCache,
                        lookup,
                        directMatch
                    );
                    cacheDirty = true;
                } else {
                    unresolved.push(lookup);
                }
            }

            if (unresolved.length > 0) {
                const aliasMatches = await this.findLocalizedTitleMatches(
                    index,
                    unresolved
                );
                const stillUnresolved: MovieLookup[] = [];

                for (const lookup of unresolved) {
                    const match = aliasMatches.get(String(lookup.id));
                    if (match) {
                        matches[String(lookup.id)] = match;
                        this.writeLookupCacheEntries(
                            aliasCache,
                            lookup,
                            match
                        );
                        cacheDirty = true;
                    } else {
                        stillUnresolved.push(lookup);
                    }
                }

                if (stillUnresolved.length > 0) {
                    const searchCandidateLookups = stillUnresolved.slice(
                        0,
                        MAX_SUGGESTION_LOOKUPS_PER_REQUEST
                    );
                    const searchMatches =
                        await this.findSuggestionSearchMatches(
                            index,
                            searchCandidateLookups
                        );

                    for (const lookup of searchCandidateLookups) {
                        const match = searchMatches.get(String(lookup.id));
                        if (!match) {
                            continue;
                        }
                        matches[String(lookup.id)] = match;
                        this.writeLookupCacheEntries(
                            aliasCache,
                            lookup,
                            match
                        );
                        cacheDirty = true;
                    }

                    for (const lookup of searchCandidateLookups) {
                        if (!searchMatches.has(String(lookup.id))) {
                            this.writeLookupMissEntries(aliasCache, lookup);
                            cacheDirty = true;
                        }
                    }
                }

            }

            if (cacheDirty) {
                await this.writeAliasCache(aliasCache);
            }

            return {
                status: 'ready',
                matches,
                cacheUpdatedAt: index.builtAt,
            };
        } catch (error) {
            return {
                status: 'error',
                matches: {},
                error:
                    error instanceof Error
                        ? error.message
                        : 'Unknown IMDb resolver error',
            };
        }
    }

    private async loadTitleIndex(): Promise<ImdbTitleIndex> {
        if (!this.indexPromise) {
            this.indexPromise = this.loadOrBuildTitleIndex();
        }

        return this.indexPromise;
    }

    private async loadOrBuildTitleIndex(): Promise<ImdbTitleIndex> {
        await this.ensureDatasetFile('ratings');
        await this.ensureDatasetFile('basics');

        const indexPath = this.getIndexPath();
        if (existsSync(indexPath)) {
            try {
                const data = JSON.parse(
                    await readFile(indexPath, 'utf8')
                ) as ImdbTitleIndexData;
                if (data.version === INDEX_VERSION) {
                    return this.hydrateIndex(data);
                }
            } catch {
                // Rebuild a corrupt or incompatible cache.
            }
        }

        const ratings = await this.parseRatings();
        const byTitle: Record<string, number[]> = {};
        const byTitleYear: Record<string, number[]> = {};
        const records: ImdbTitleRecord[] = [];

        await this.forEachGzipTsvRow(
            this.getDatasetPath('basics'),
            (row, header) => {
                const titleType = row[header.titleType];
                const imdbId = row[header.tconst];
                const rating = ratings.get(imdbId);
                if (
                    !rating ||
                    !SUPPORTED_TITLE_TYPES.has(titleType) ||
                    row[header.isAdult] === '1'
                ) {
                    return;
                }

                const primaryTitle = this.cleanDatasetValue(
                    row[header.primaryTitle]
                );
                const originalTitle = this.cleanDatasetValue(
                    row[header.originalTitle]
                );
                const normalizedPrimaryTitle =
                    this.normalizeTitle(primaryTitle);
                const normalizedOriginalTitle =
                    this.normalizeTitle(originalTitle);

                if (!normalizedPrimaryTitle && !normalizedOriginalTitle) {
                    return;
                }

                const record: ImdbTitleRecord = {
                    imdbId,
                    primaryTitle,
                    originalTitle,
                    titleType,
                    normalizedPrimaryTitle,
                    normalizedOriginalTitle,
                    year: this.parseOptionalNumber(row[header.startYear]),
                    runtimeMinutes: this.parseOptionalNumber(
                        row[header.runtimeMinutes]
                    ),
                    rating: rating.rating,
                    votes: rating.votes,
                };
                const recordIndex = records.push(record) - 1;

                this.addRecordToTitleIndex(
                    byTitle,
                    byTitleYear,
                    normalizedPrimaryTitle,
                    record.year,
                    recordIndex
                );
                this.addRecordToTitleIndex(
                    byTitle,
                    byTitleYear,
                    normalizedOriginalTitle,
                    record.year,
                    recordIndex
                );
            }
        );

        const data: ImdbTitleIndexData = {
            version: INDEX_VERSION,
            builtAt: new Date().toISOString(),
            records,
            byTitle,
            byTitleYear,
        };

        await this.writeJsonFile(indexPath, data);
        return this.hydrateIndex(data);
    }

    private hydrateIndex(data: ImdbTitleIndexData): ImdbTitleIndex {
        const recordIndexById = new Map<string, number>();
        data.records.forEach((record, index) => {
            recordIndexById.set(record.imdbId, index);
        });

        return {
            ...data,
            recordIndexById,
        };
    }

    private async parseRatings(): Promise<Map<string, ImdbRatingRecord>> {
        const ratings = new Map<string, ImdbRatingRecord>();
        await this.forEachGzipTsvRow(
            this.getDatasetPath('ratings'),
            (row, header) => {
                const rating = Number.parseFloat(row[header.averageRating]);
                const votes = Number.parseInt(row[header.numVotes], 10);
                if (Number.isFinite(rating) && Number.isFinite(votes)) {
                    ratings.set(row[header.tconst], {
                        rating,
                        votes,
                    });
                }
            }
        );

        return ratings;
    }

    private async findLocalizedTitleMatches(
        index: ImdbTitleIndex,
        lookups: MovieLookup[]
    ): Promise<Map<string, ImdbMovieRatingMatch>> {
        if (!ENABLE_FULL_ALIAS_SCAN) {
            return new Map();
        }

        await this.ensureDatasetFile('akas');

        const byWantedTitle = new Map<string, MovieLookup[]>();
        for (const lookup of lookups) {
            for (const title of lookup.normalizedTitles) {
                const list = byWantedTitle.get(title) ?? [];
                list.push(lookup);
                byWantedTitle.set(title, list);
            }
        }

        const bestByLookupId = new Map<string, ScoredMatch>();

        await this.forEachGzipTsvRow(
            this.getDatasetPath('akas'),
            (row, header) => {
                const normalizedAlias = this.normalizeTitle(row[header.title]);
                if (!normalizedAlias) {
                    return;
                }

                const matchingLookups = byWantedTitle.get(normalizedAlias);
                if (!matchingLookups) {
                    return;
                }

                const recordIndex = index.recordIndexById.get(
                    row[header.titleId]
                );
                if (recordIndex === undefined) {
                    return;
                }

                const record = index.records[recordIndex];
                for (const lookup of matchingLookups) {
                    const scored = this.scoreRecord(
                        record,
                        lookup,
                        'localized-title'
                    );
                    if (!scored) {
                        continue;
                    }

                    this.keepBestMatch(bestByLookupId, lookup.id, scored);
                }
            }
        );

        const matches = new Map<string, ImdbMovieRatingMatch>();
        for (const [lookupId, scored] of bestByLookupId) {
            matches.set(lookupId, scored.match);
        }

        return matches;
    }

    private async findSuggestionSearchMatches(
        index: ImdbTitleIndex,
        lookups: MovieLookup[]
    ): Promise<Map<string, ImdbMovieRatingMatch>> {
        const bestByLookupId = new Map<string, ScoredMatch>();
        let searchedLookups = 0;

        for (const lookup of lookups) {
            if (searchedLookups >= MAX_SUGGESTION_LOOKUPS_PER_REQUEST) {
                break;
            }
            searchedLookups += 1;

            for (const query of lookup.searchQueries.slice(
                0,
                MAX_SUGGESTION_QUERIES_PER_LOOKUP
            )) {
                const suggestions = await this.fetchImdbSuggestions(query);
                for (const suggestion of suggestions) {
                    if (!suggestion.id?.startsWith('tt')) {
                        continue;
                    }

                    const recordIndex = index.recordIndexById.get(
                        suggestion.id
                    );
                    if (recordIndex === undefined) {
                        continue;
                    }

                    const record = index.records[recordIndex];
                    const scored = this.scoreRecord(
                        record,
                        lookup,
                        'imdb-search'
                    );
                    if (!scored) {
                        continue;
                    }

                    const rankPenalty = Math.min(
                        (suggestion.rank ?? 100000) / 1000000,
                        0.08
                    );
                    const score = Math.max(scored.score - rankPenalty, 0);
                    this.keepBestMatch(bestByLookupId, lookup.id, {
                        score,
                        match: {
                            ...scored.match,
                            confidence: Number(score.toFixed(3)),
                            matchReason: `imdb-search${
                                lookup.year !== undefined ? '+year' : '+rank'
                            }`,
                        },
                    });
                }

                const current = bestByLookupId.get(String(lookup.id));
                if (current && current.score >= 0.82) {
                    break;
                }
            }
        }

        const matches = new Map<string, ImdbMovieRatingMatch>();
        for (const [lookupId, scored] of bestByLookupId) {
            matches.set(lookupId, scored.match);
        }

        return matches;
    }

    private findBestIndexedMatch(
        index: ImdbTitleIndex,
        lookup: MovieLookup
    ): ImdbMovieRatingMatch | null {
        if (lookup.imdbId) {
            const recordIndex = index.recordIndexById.get(lookup.imdbId);
            const record =
                recordIndex === undefined
                    ? undefined
                    : index.records[recordIndex];
            if (record && this.getRecordKind(record) === lookup.kind) {
                return this.createDirectIdMatch(record, lookup);
            }
        }

        const candidateIndexes = new Set<number>();

        for (const title of lookup.normalizedTitles) {
            if (lookup.year !== undefined) {
                for (const year of [
                    lookup.year,
                    lookup.year - 1,
                    lookup.year + 1,
                ]) {
                    const indexes =
                        index.byTitleYear[this.titleYearKey(title, year)];
                    indexes?.forEach((recordIndex) =>
                        candidateIndexes.add(recordIndex)
                    );
                }
            }

            index.byTitle[title]?.forEach((recordIndex) =>
                candidateIndexes.add(recordIndex)
            );
        }

        let best: ScoredMatch | null = null;
        for (const recordIndex of candidateIndexes) {
            const record = index.records[recordIndex];
            const scored = this.scoreRecord(record, lookup, 'title');
            if (!scored) {
                continue;
            }

            if (
                !best ||
                scored.score > best.score ||
                (scored.score === best.score &&
                    scored.match.votes > best.match.votes)
            ) {
                best = scored;
            }
        }

        return best?.match ?? null;
    }

    private scoreRecord(
        record: ImdbTitleRecord,
        lookup: MovieLookup,
        source: 'title' | 'localized-title' | 'imdb-search'
    ): ScoredMatch | null {
        if (this.getRecordKind(record) !== lookup.kind) {
            return null;
        }

        const hasYear = lookup.year !== undefined;
        let yearScore = 0.66;

        if (hasYear) {
            if (record.year === undefined) {
                yearScore = 0.5;
            } else {
                const diff = Math.abs(record.year - lookup.year!);
                if (diff > 2) {
                    return null;
                }
                yearScore = diff === 0 ? 1 : diff === 1 ? 0.88 : 0.72;
            }
        }

        const voteScore = Math.min(Math.log10(record.votes + 1) / 8, 0.08);
        const durationScore = this.getDurationScore(record, lookup);
        const sourceBase =
            source === 'title'
                ? 0.74
                : source === 'localized-title'
                  ? 0.72
                  : 0.68;
        const rawScore =
            sourceBase + yearScore * 0.18 + voteScore + durationScore;
        const maxScore =
            source === 'imdb-search'
                ? hasYear
                    ? 0.96
                    : 0.8
                : hasYear
                  ? 0.99
                  : 0.84;
        const score = Math.min(maxScore, rawScore);

        return {
            score,
            match: {
                id: lookup.id,
                imdbId: record.imdbId,
                rating: record.rating,
                votes: record.votes,
                title: record.primaryTitle || record.originalTitle,
                year: record.year,
                runtimeMinutes: record.runtimeMinutes,
                confidence: Number(score.toFixed(3)),
                matchReason: `${source}${hasYear ? '+year' : '+votes'}`,
            },
        };
    }

    private createDirectIdMatch(
        record: ImdbTitleRecord,
        lookup: MovieLookup
    ): ImdbMovieRatingMatch {
        return {
            id: lookup.id,
            imdbId: record.imdbId,
            rating: record.rating,
            votes: record.votes,
            title: record.primaryTitle || record.originalTitle,
            year: record.year,
            runtimeMinutes: record.runtimeMinutes,
            confidence: 1,
            matchReason: 'imdb-id',
        };
    }

    private getRecordKind(record: Pick<ImdbTitleRecord, 'titleType'>) {
        return SERIES_TITLE_TYPES.has(record.titleType) ? 'series' : 'movie';
    }

    private getDurationScore(
        record: ImdbTitleRecord,
        lookup: MovieLookup
    ): number {
        if (
            record.runtimeMinutes === undefined ||
            lookup.durationMinutes === undefined
        ) {
            return 0;
        }

        const diff = Math.abs(record.runtimeMinutes - lookup.durationMinutes);
        if (diff <= 3) {
            return 0.04;
        }
        if (diff <= 10) {
            return 0.02;
        }
        if (diff >= 25) {
            return -0.05;
        }

        return 0;
    }

    private keepBestMatch(
        matches: Map<string, ScoredMatch>,
        id: string | number,
        scored: ScoredMatch
    ): void {
        const key = String(id);
        const current = matches.get(key);
        if (
            !current ||
            scored.score > current.score ||
            (scored.score === current.score &&
                scored.match.votes > current.match.votes)
        ) {
            matches.set(key, scored);
        }
    }

    private findCachedAliasMatch(
        lookup: MovieLookup,
        aliasCache: ImdbAliasCache
    ): ImdbMovieRatingMatch | null {
        for (const cacheKey of lookup.cacheKeys) {
            const entry = aliasCache[cacheKey];
            if (this.isAliasCacheMatch(entry)) {
                return {
                    ...entry,
                    id: lookup.id,
                };
            }
        }

        return null;
    }

    private hasFreshAliasMiss(
        lookup: MovieLookup,
        aliasCache: ImdbAliasCache
    ): boolean {
        if (lookup.cacheKeys.length === 0) {
            return false;
        }

        const now = Date.now();
        return lookup.cacheKeys.every((cacheKey) => {
            const entry = aliasCache[cacheKey];
            return (
                this.isAliasCacheMiss(entry) &&
                now - entry.cachedAt < ALIAS_NEGATIVE_MISS_TTL_MS
            );
        });
    }

    private writeLookupCacheEntries(
        aliasCache: ImdbAliasCache,
        lookup: MovieLookup,
        match: ImdbMovieRatingMatch
    ): void {
        for (const cacheKey of lookup.cacheKeys) {
            aliasCache[cacheKey] = {
                ...match,
                id: lookup.id,
            };
        }
    }

    private writeLookupMissEntries(
        aliasCache: ImdbAliasCache,
        lookup: MovieLookup
    ): void {
        const cachedAt = Date.now();
        for (const cacheKey of lookup.cacheKeys) {
            aliasCache[cacheKey] = {
                miss: true,
                cachedAt,
            };
        }
    }

    private isAliasCacheMatch(
        value: ImdbAliasCacheEntry | undefined
    ): value is ImdbMovieRatingMatch {
        return Boolean(
            value &&
                !('miss' in value) &&
                typeof value.imdbId === 'string' &&
                typeof value.rating === 'number'
        );
    }

    private isAliasCacheMiss(
        value: ImdbAliasCacheEntry | undefined
    ): value is ImdbAliasCacheMiss {
        return Boolean(
            value &&
                'miss' in value &&
                value.miss === true &&
                typeof value.cachedAt === 'number'
        );
    }

    private createLookup(item: ImdbMovieRatingRequestItem): MovieLookup | null {
        const kind: ImdbLookupKind =
            item.kind === 'series' ? 'series' : 'movie';
        const imdbId = this.normalizeImdbId(item.imdbId);
        const rawTitles = [item.title, item.originalTitle].filter(
            (value): value is string => typeof value === 'string'
        );
        const titles = rawTitles
            .filter((value): value is string => typeof value === 'string')
            .flatMap((value) => this.createTitleCandidates(value));
        const normalizedTitles = [...new Set(titles)].filter(Boolean);
        const searchQueries = [
            ...new Set(
                rawTitles.flatMap((value) => this.createSearchQueries(value))
            ),
        ].filter(Boolean);

        if (normalizedTitles.length === 0 && !imdbId) {
            return null;
        }

        const year =
            this.parseOptionalNumber(item.year) ??
            this.extractYear(`${item.title} ${item.originalTitle ?? ''}`);
        const durationMinutes = this.parseOptionalNumber(item.durationMinutes);
        const cacheKeys = normalizedTitles.map((title) =>
            this.lookupCacheKey(kind, title, year)
        );
        if (imdbId) {
            cacheKeys.push(`${kind}|imdb:${imdbId}`);
        }

        return {
            id: item.id,
            imdbId,
            kind,
            normalizedTitles,
            searchQueries,
            year,
            durationMinutes,
            cacheKeys,
        };
    }

    private createSearchQueries(value: string): string[] {
        const withoutExtension = value.replace(/\.[a-z0-9]{2,5}$/i, ' ');
        const withoutBrackets = withoutExtension.replace(
            /[\[({][^\])}]*[\])}]/g,
            ' '
        );
        const spaced = withoutBrackets.replace(/[._]+/g, ' ');
        const withoutTags = spaced.replace(
            /\b(?:2160p|1080p|720p|480p|uhd|hdr|hdr10|dv|dolby|vision|4k|x264|x265|h264|h265|hevc|avc|web[- ]?dl|webrip|bluray|bdrip|hdrip|dvdrip|remux|multi|ita|eng|sub|subs|aac|ac3|eac3|dts|atmos|truehd|10bit)\b/gi,
            ' '
        );
        const withoutYear = withoutTags.replace(/\b(?:19|20)\d{2}\b/g, ' ');
        const beforeSeparators = withoutYear
            .split(/\s(?:-|--|\||\/)\s/g)
            .map((item) => item.trim());

        return [withoutYear.trim(), ...beforeSeparators]
            .map((item) => item.replace(/\s+/g, ' ').trim())
            .filter((item) => item.length > 1);
    }

    private createTitleCandidates(value: string): string[] {
        const withoutExtension = value.replace(/\.[a-z0-9]{2,5}$/i, ' ');
        const withoutBrackets = withoutExtension.replace(
            /[\[({][^\])}]*[\])}]/g,
            ' '
        );
        const spaced = withoutBrackets.replace(/[._]+/g, ' ');
        const withoutYear = spaced.replace(/\b(?:19|20)\d{2}\b/g, ' ');
        const withoutTags = withoutYear.replace(
            /\b(?:2160p|1080p|720p|480p|uhd|hdr|hdr10|dv|dolby|vision|4k|x264|x265|h264|h265|hevc|avc|web[- ]?dl|webrip|bluray|bdrip|hdrip|dvdrip|remux|multi|ita|eng|sub|subs|aac|ac3|eac3|dts|atmos|truehd|10bit)\b/gi,
            ' '
        );
        const beforeSeparators = withoutTags
            .split(/\s(?:-|--|\||\/)\s/g)
            .map((item) => item.trim());
        const candidates = [withoutTags.trim(), ...beforeSeparators]
            .map((item) => this.normalizeTitle(item))
            .flatMap((item) => this.withoutLeadingArticles(item));

        return [...new Set(candidates)].filter(Boolean);
    }

    private withoutLeadingArticles(value: string): string[] {
        const articlePattern =
            /^(?:the|a|an|il|lo|la|i|gli|le|un|uno|una|l)\s+/;
        const withoutArticle = value.replace(articlePattern, '');
        return withoutArticle === value ? [value] : [value, withoutArticle];
    }

    private normalizeTitle(value: string): string {
        return this.cleanDatasetValue(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/&/g, ' and ')
            .replace(/['’`]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .trim()
            .toLocaleLowerCase();
    }

    private extractYear(value: string): number | undefined {
        const match = value.match(/\b(19\d{2}|20\d{2})\b/);
        if (!match) {
            return undefined;
        }

        return Number.parseInt(match[1], 10);
    }

    private addRecordToTitleIndex(
        byTitle: Record<string, number[]>,
        byTitleYear: Record<string, number[]>,
        normalizedTitle: string,
        year: number | undefined,
        recordIndex: number
    ): void {
        if (!normalizedTitle) {
            return;
        }

        this.addIndexValue(byTitle, normalizedTitle, recordIndex);
        if (year !== undefined) {
            this.addIndexValue(
                byTitleYear,
                this.titleYearKey(normalizedTitle, year),
                recordIndex
            );
        }
    }

    private addIndexValue(
        index: Record<string, number[]>,
        key: string,
        value: number
    ): void {
        const list = index[key] ?? [];
        if (!list.includes(value)) {
            list.push(value);
        }
        index[key] = list;
    }

    private titleYearKey(title: string, year: number): string {
        return `${title}|${year}`;
    }

    private lookupCacheKey(
        kind: ImdbLookupKind,
        title: string,
        year?: number
    ): string {
        return `${kind}|${title}|${year ?? ''}`;
    }

    private normalizeImdbId(value: unknown): string | undefined {
        if (typeof value !== 'string' && typeof value !== 'number') {
            return undefined;
        }

        const raw = String(value).trim().toLocaleLowerCase();
        const match = raw.match(/tt\d{5,}/);
        return match?.[0];
    }

    private cleanDatasetValue(value: string | undefined): string {
        return value && value !== '\\N' ? value : '';
    }

    private parseOptionalNumber(value: unknown): number | undefined {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : undefined;
        }

        if (typeof value !== 'string' || value === '\\N') {
            return undefined;
        }

        const numeric = Number.parseInt(value.trim(), 10);
        return Number.isFinite(numeric) ? numeric : undefined;
    }

    private async fetchImdbSuggestions(
        query: string
    ): Promise<ImdbSuggestionItem[]> {
        const normalizedQuery = query.replace(/\s+/g, ' ').trim();
        const firstPathSegment =
            this.normalizeTitle(normalizedQuery).charAt(0) || 'x';
        const encodedQuery = encodeURIComponent(
            normalizedQuery.toLocaleLowerCase()
        );
        const url = `https://v3.sg.media-imdb.com/suggestion/${firstPathSegment}/${encodedQuery}.json`;

        try {
            const response = await this.fetchJson<ImdbSuggestionResponse>(url);
            return response.d ?? [];
        } catch {
            return [];
        }
    }

    private async fetchJson<T>(url: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const request = https.get(
                url,
                {
                    headers: {
                        accept: 'application/json,text/plain,*/*',
                        'user-agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
                    },
                },
                (response) => {
                    const statusCode = response.statusCode ?? 0;
                    const redirectUrl = response.headers.location;

                    if (statusCode >= 300 && statusCode < 400 && redirectUrl) {
                        response.resume();
                        this.fetchJson<T>(new URL(redirectUrl, url).toString())
                            .then(resolve)
                            .catch(reject);
                        return;
                    }

                    if (statusCode < 200 || statusCode >= 300) {
                        response.resume();
                        reject(
                            new Error(
                                `IMDb search failed with HTTP ${statusCode}`
                            )
                        );
                        return;
                    }

                    response.setEncoding('utf8');
                    let body = '';
                    response.on('data', (chunk) => {
                        body += chunk;
                    });
                    response.on('end', () => {
                        try {
                            resolve(JSON.parse(body) as T);
                        } catch (error) {
                            reject(error);
                        }
                    });
                }
            );

            request.setTimeout(8000, () => {
                request.destroy(new Error('IMDb search timed out'));
            });
            request.on('error', reject);
        });
    }

    private async forEachGzipTsvRow(
        filePath: string,
        onRow: (row: string[], header: Record<string, number>) => void
    ): Promise<void> {
        const stream = createReadStream(filePath).pipe(createGunzip());
        const lineReader = readline.createInterface({
            input: stream,
            crlfDelay: Infinity,
        });
        let header: Record<string, number> | null = null;

        for await (const line of lineReader) {
            if (!header) {
                header = line
                    .split('\t')
                    .reduce<Record<string, number>>((acc, key, index) => {
                        acc[key] = index;
                        return acc;
                    }, {});
                continue;
            }

            onRow(line.split('\t'), header);
        }
    }

    private async ensureDatasetFile(
        type: keyof typeof DATASET_URLS
    ): Promise<void> {
        const filePath = this.getDatasetPath(type);
        if (existsSync(filePath) && statSync(filePath).size > 0) {
            return;
        }

        await mkdir(path.dirname(filePath), { recursive: true });
        await this.downloadFile(DATASET_URLS[type], filePath);
    }

    private async downloadFile(
        url: string,
        destination: string
    ): Promise<void> {
        const tmpPath = `${destination}.download`;

        await new Promise<void>((resolve, reject) => {
            const request = (targetUrl: string, redirectCount = 0): void => {
                const responseHandler = (response: IncomingMessage): void => {
                    const statusCode = response.statusCode ?? 0;
                    const redirectUrl = response.headers.location;

                    if (
                        statusCode >= 300 &&
                        statusCode < 400 &&
                        redirectUrl &&
                        redirectCount < 5
                    ) {
                        response.resume();
                        request(
                            new URL(redirectUrl, targetUrl).toString(),
                            redirectCount + 1
                        );
                        return;
                    }

                    if (statusCode < 200 || statusCode >= 300) {
                        response.resume();
                        reject(
                            new Error(
                                `IMDb dataset download failed with HTTP ${statusCode}`
                            )
                        );
                        return;
                    }

                    pipeline(response, createWriteStream(tmpPath))
                        .then(() => resolve())
                        .catch(reject);
                };

                https.get(targetUrl, responseHandler).on('error', reject);
            };

            request(url);
        });

        await rename(tmpPath, destination);
    }

    private async readAliasCache(): Promise<ImdbAliasCache> {
        const cachePaths = await this.getAliasCacheReadPaths();
        let mergedCache: ImdbAliasCache = {};

        for (const cachePath of cachePaths) {
            mergedCache = {
                ...mergedCache,
                ...(await this.readAliasCacheFile(cachePath)),
            };
        }

        return mergedCache;
    }

    private async getAliasCacheReadPaths(): Promise<string[]> {
        const cacheDir = this.getCacheDir();
        const primaryPath = this.getAliasCachePath();
        const paths = new Set<string>();

        try {
            const entries = await readdir(cacheDir);
            for (const entry of entries) {
                if (LEGACY_ALIAS_CACHE_PATTERN.test(entry)) {
                    paths.add(path.join(cacheDir, entry));
                }
            }
        } catch {
            // Cache directory may not exist yet.
        }

        paths.delete(primaryPath);
        return [...paths].sort().concat(primaryPath);
    }

    private async readAliasCacheFile(cachePath: string): Promise<ImdbAliasCache> {
        if (!existsSync(cachePath)) {
            return {};
        }

        try {
            const parsed = JSON.parse(
                await readFile(cachePath, 'utf8')
            ) as ImdbAliasCache;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    private async writeAliasCache(cache: ImdbAliasCache): Promise<void> {
        await this.writeJsonFile(this.getAliasCachePath(), cache);
    }

    private async writeJsonFile(
        filePath: string,
        value: unknown
    ): Promise<void> {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, JSON.stringify(value), 'utf8');
    }

    private getCacheDir(): string {
        return path.join(app.getPath('userData'), 'imdb');
    }

    private getDatasetPath(type: keyof typeof DATASET_URLS): string {
        return path.join(this.getCacheDir(), `${type}.tsv.gz`);
    }

    private getIndexPath(): string {
        return path.join(
            this.getCacheDir(),
            `movie-ratings-v${INDEX_VERSION}.json`
        );
    }

    private getAliasCachePath(): string {
        return path.join(this.getCacheDir(), 'movie-rating-aliases.json');
    }
}

export const imdbRatingsService = new ImdbRatingsService();
