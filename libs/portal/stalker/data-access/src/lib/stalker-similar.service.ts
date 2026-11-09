import { Injectable, inject } from '@angular/core';
import { DataService } from '@iptvnator/services';
import {
    extractYear,
    isStalkerSeriesItem,
    normalizeTitleKeys,
    releaseTagYear,
    titleYearsCompatible,
    type PlaylistMeta,
    type TmdbMediaType,
    type TmdbRecommendation,
} from '@iptvnator/shared/interfaces';
import type { StalkerVodSource } from './models';
import { resolveStalkerArtwork } from './stalker-artwork.utils';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerSessionService } from './stalker-session.service';
import {
    loadStalkerSearchPage,
    type StalkerSearchContentType,
} from './stalker-search-page';

export interface StalkerSimilarSubject {
    catalog: StalkerSearchContentType;
    id: string;
    mediaType: TmdbMediaType;
    tmdbId?: number;
}

export interface StalkerSimilarMatch {
    recommendation: TmdbRecommendation;
    catalog: StalkerSearchContentType;
    item: StalkerVodSource & { id: string; category_id: string };
}

@Injectable({ providedIn: 'root' })
export class StalkerSimilarService {
    private readonly requestDeps = {
        dataService: inject(DataService),
        stalkerSession: inject(StalkerSessionService),
        portalRepair: inject(StalkerPortalRepairService),
    };

    async match(
        playlist: PlaylistMeta,
        subject: StalkerSimilarSubject,
        recommendations: readonly TmdbRecommendation[],
        signal: AbortSignal
    ): Promise<StalkerSimilarMatch[]> {
        // shortcut: first page of four title searches; expand only if portal
        // fixtures show that useful matches regularly fall outside that budget.
        const candidates = recommendations
            .filter(
                (item) => item.tmdbId !== subject.tmdbId && item.title.trim()
            )
            .slice(0, 4);
        const results: StalkerSimilarMatch[] = [];
        const seen = new Set<string>();
        for (
            let index = 0;
            index < candidates.length && !signal.aborted;
            index += 2
        ) {
            const batch = await Promise.all(
                candidates
                    .slice(index, index + 2)
                    .map((candidate) =>
                        this.matchTitle(playlist, subject, candidate, signal)
                    )
            );
            for (const match of batch) {
                if (!match) continue;
                const key = JSON.stringify([match.catalog, match.item.id]);
                if (seen.has(key)) continue;
                seen.add(key);
                results.push(match);
            }
        }
        return signal.aborted ? [] : results;
    }

    private async matchTitle(
        playlist: PlaylistMeta,
        subject: StalkerSimilarSubject,
        recommendation: TmdbRecommendation,
        signal: AbortSignal
    ): Promise<StalkerSimilarMatch | null> {
        const wanted = normalizeTitleKeys(recommendation.title).exact;
        if (!wanted) return null;
        const catalogs: StalkerSearchContentType[] =
            subject.mediaType === 'tv' ? ['series', 'vod'] : ['vod'];
        const matches = new Map<string, StalkerSimilarMatch>();
        for (const catalog of catalogs) {
            if (signal.aborted) return null;
            const rows = await this.search(
                playlist,
                catalog,
                recommendation.title
            );
            for (const row of rows) {
                if (!row || typeof row !== 'object') continue;
                const isSeries =
                    catalog === 'series' || isStalkerSeriesItem(row);
                if (isSeries !== (subject.mediaType === 'tv')) continue;
                const id =
                    providerKey(row.id) ||
                    providerKey(row.stream_id) ||
                    providerKey(row.series_id) ||
                    providerKey(row.movie_id);
                const categoryId = providerKey(row.category_id);
                if (
                    !id ||
                    !categoryId ||
                    categoryId === '*' ||
                    (catalog === subject.catalog && id === subject.id)
                ) {
                    continue;
                }
                if (matchesTitle(row, wanted, recommendation.year)) {
                    const poster = resolveStalkerArtwork(
                        playlist.portalUrl ?? '',
                        row.info?.movie_image,
                        row.cover,
                        row.screenshot_uri,
                        row.logo
                    );
                    matches.set(JSON.stringify([catalog, id, categoryId]), {
                        recommendation,
                        catalog,
                        item: {
                            ...row,
                            id,
                            category_id: categoryId,
                            ...(poster
                                ? { info: { ...row.info, movie_image: poster } }
                                : {}),
                        },
                    });
                }
            }
        }
        return matches.size === 1
            ? (matches.values().next().value ?? null)
            : null;
    }

    private async search(
        playlist: PlaylistMeta,
        catalog: StalkerSearchContentType,
        title: string
    ): Promise<StalkerVodSource[]> {
        try {
            const { rawItems } = await loadStalkerSearchPage(
                this.requestDeps,
                playlist,
                catalog,
                title,
                1,
                { silent: true }
            );
            return rawItems;
        } catch {
            return [];
        }
    }
}

function providerKey(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number'
        ? String(value).trim()
        : '';
}

function matchesTitle(
    row: StalkerVodSource,
    wanted: string,
    year: number | null
): boolean {
    const releaseYear =
        extractYear(providerKey(row.info?.releasedate)) ??
        extractYear(providerKey(row.releasedate)) ??
        extractYear(providerKey(row.year));
    if (!titleYearsCompatible(year, releaseYear)) return false;

    let matches = false;
    for (const title of [
        row.name,
        row.o_name,
        row.title,
        row.info?.name,
        row.info?.o_name,
    ]) {
        if (typeof title !== 'string') continue;
        const keys = normalizeTitleKeys(title);
        const exact = wanted === keys.exact;
        const baseOnly = !exact && wanted === keys.base;
        matches ||= exact || baseOnly;
        if (releaseYear !== null || year === null) continue;

        const tag = releaseTagYear(title);
        // A bare trailing year can be part of the name; only use it when
        // stripping it made the title match. Bracketed tags apply across aliases.
        if (tag === keys.trailingYear && !baseOnly) continue;
        if (!titleYearsCompatible(year, tag)) return false;
    }
    return matches;
}
