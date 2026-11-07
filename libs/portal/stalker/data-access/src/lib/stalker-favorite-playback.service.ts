import { inject, Injectable } from '@angular/core';
import { DataService, ParentalLockService } from '@iptvnator/services';
import { PlaylistMeta, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import {
    favoriteReferenceKey,
    stalkerFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { executeStalkerRequest } from './stores/utils/stalker-request.utils';
import { firstNonBlankStalkerId } from './stalker-vod.utils';
import { StalkerPagedCatalog } from './stalker-paged-client';

/** Resolve commands on the receiving device; commands never enter sync snapshots. */
@Injectable({ providedIn: 'root' })
export class StalkerFavoritePlaybackResolver {
    private readonly deps = {
        dataService: inject(DataService),
        stalkerSession: inject(StalkerSessionService),
        portalRepair: inject(StalkerPortalRepairService),
    };
    private readonly parental = inject(ParentalLockService);

    async resolve(
        playlist: PlaylistMeta,
        item: StalkerPortalItem & { info?: { name?: string } }
    ): Promise<StalkerPortalItem> {
        if (item.cmd) return item;
        return this.lookup(playlist, item, true);
    }

    metadata(
        playlist: PlaylistMeta,
        item: StalkerPortalItem & { info?: { name?: string } }
    ): Promise<StalkerPortalItem> {
        return this.lookup(playlist, item, false);
    }

    private async lookup(
        playlist: PlaylistMeta,
        item: StalkerPortalItem & { info?: { name?: string } },
        requireCommand: boolean
    ): Promise<StalkerPortalItem> {
        playlist = {
            ...playlist,
            portalUrl: playlist.portalUrl ?? playlist.url,
        };
        if (!playlist.portalUrl || !playlist.macAddress)
            throw new Error('nothing_to_play');
        const reference = stalkerFavoriteReference(item);
        if (!reference) throw new Error('nothing_to_play');
        const expectedKey = favoriteReferenceKey(reference);
        const type =
            reference.kind === 'live'
                ? 'itv'
                : reference.kind === 'radio'
                  ? 'radio'
                  : reference.kind === 'series' && reference.mode === 'regular'
                    ? 'series'
                    : 'vod';
        const match = (row: Record<string, unknown>) => {
            const candidate = {
                ...row,
                favoriteContentType: type,
            } as StalkerPortalItem;
            const keys = [
                candidate,
                {
                    ...candidate,
                    id: firstNonBlankStalkerId(
                        candidate.stream_id,
                        candidate.id
                    ),
                },
            ].map(stalkerFavoriteReference);
            if (
                !keys.some(
                    (key) => key && favoriteReferenceKey(key) === expectedKey
                )
            )
                return null;
            const category =
                type === 'itv' || type === 'radio'
                    ? row['tv_genre_id']
                    : candidate.category_id;
            if (
                this.parental.isStalkerCategoryLocked(
                    playlist._id,
                    type,
                    category as string | number | undefined
                )
            )
                throw new Error('nothing_to_play');
            return candidate;
        };
        const found = new Map<string, StalkerPortalItem>();
        let canonicalFound = false;
        let plainFound = false;
        const command = (row: StalkerPortalItem) =>
            typeof row.cmd === 'string' ? row.cmd.trim() : '';
        const collect = (row: Record<string, unknown>) => {
            const candidate = match(row);
            if (!candidate) return;
            const canonical = stalkerFavoriteReference({
                ...candidate,
                id: firstNonBlankStalkerId(candidate.stream_id, candidate.id),
            })!;
            const key = favoriteReferenceKey(canonical);
            if (key === expectedKey) canonicalFound = true;
            if (
                key === expectedKey &&
                (!requireCommand || command(candidate)) &&
                favoriteReferenceKey(stalkerFavoriteReference(candidate)!) ===
                    key
            )
                plainFound = true;
            const previous = found.get(key);
            if (
                (found.size && !previous) ||
                (previous &&
                    command(previous) &&
                    command(candidate) &&
                    command(previous) !== command(candidate))
            )
                throw new Error('nothing_to_play');
            if (!previous || command(candidate)) found.set(key, candidate);
        };
        const selected = () => {
            const candidate = found.values().next().value;
            return candidate && (!requireCommand || command(candidate))
                ? { ...candidate, id: reference.id }
                : undefined;
        };
        if (type === 'itv') {
            const result = await executeStalkerRequest<{ js?: unknown }>(
                this.deps,
                playlist,
                { type, action: 'get_all_channels' }
            ).catch(() => undefined);
            const rows = Array.isArray(result?.js)
                ? result.js
                : (result?.js as { data?: unknown[] })?.data;
            for (const row of rows ?? []) {
                if (row && typeof row === 'object') {
                    collect(row as Record<string, unknown>);
                }
            }
        }
        const bulk = selected();
        if (bulk) return bulk;
        const catalog = new StalkerPagedCatalog((params) =>
            executeStalkerRequest(this.deps, playlist, params)
        );
        const signal = new AbortController().signal;
        const title = String(
            item.title ?? item.name ?? item.info?.name ?? ''
        ).trim();
        for (const search of title ? [title, ''] : ['']) {
            let complete = false;
            for (let page = 0; page < 20; page++) {
                const result = await catalog.load(
                    {
                        type,
                        category: '*',
                        genre: '0',
                        search,
                        sortby: 'added',
                    },
                    page,
                    signal
                );
                for (const row of result.data) {
                    collect(row);
                }
                const direct = plainFound ? selected() : undefined;
                if (direct) return direct;
                if (
                    !result.data.length ||
                    (page + 1) * result.pageSize >= result.total
                ) {
                    complete = true;
                    break;
                }
            }
            const resolved = selected();
            // shortcut: legacy-only aliases need a complete scan within 20 pages; use a direct ID endpoint when available.
            if (resolved && (canonicalFound || (!search && complete)))
                return resolved;
        }
        throw new Error('nothing_to_play');
    }
}
