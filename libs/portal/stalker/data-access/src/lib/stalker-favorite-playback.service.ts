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
        item: StalkerPortalItem
    ): Promise<StalkerPortalItem> {
        if (item.cmd) return item;
        playlist = {
            ...playlist,
            portalUrl: playlist.portalUrl ?? playlist.url,
        };
        if (!playlist.portalUrl || !playlist.macAddress)
            throw new Error('nothing_to_play');
        const reference = stalkerFavoriteReference(item);
        if (!reference) throw new Error('nothing_to_play');
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
            const key = stalkerFavoriteReference(candidate);
            if (
                !key ||
                favoriteReferenceKey(key) !== favoriteReferenceKey(reference) ||
                typeof candidate.cmd !== 'string' ||
                !candidate.cmd.trim()
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
                    const found = match(row as Record<string, unknown>);
                    if (found) return found;
                }
            }
        }
        const catalog = new StalkerPagedCatalog((params) =>
            executeStalkerRequest(this.deps, playlist, params)
        );
        const signal = new AbortController().signal;
        const title = String(item.title ?? item.name ?? '').trim();
        for (const search of title ? [title, ''] : ['']) {
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
                    const found = match(row);
                    if (found) return found;
                }
                if (
                    !result.data.length ||
                    (page + 1) * result.pageSize >= result.total
                )
                    break;
            }
        }
        throw new Error('nothing_to_play');
    }
}
