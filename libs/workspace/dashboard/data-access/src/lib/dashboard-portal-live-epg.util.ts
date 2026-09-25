import {
    isStalkerRadioItem,
    type EpgProgram,
    type PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import {
    buildCollectionUid,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';

/**
 * One dashboard live card's portal EPG request: the key its answer is filed
 * under (the collection uid, stable across favourites and recent rows of the
 * same channel) and the item `StreamResolverService.loadEpgForItems` fetches
 * for — the same shape the "See all" pages hand it, so the two surfaces
 * resolve a channel identically.
 */
export interface DashboardPortalLiveEpgEntry {
    readonly key: string;
    readonly item: UnifiedCollectionItem;
}

/** The key alone, for cards that only need to find their answer. */
export function buildDashboardPortalLiveEpgKey(
    item: PortalActivityItem
): string | null {
    return buildDashboardPortalLiveEpgEntry(item)?.key ?? null;
}

/**
 * M3U channels keep the dashboard's batched XMLTV lookup; Xtream and Stalker
 * live rows have no XMLTV key of their own and are answered by their portal.
 * Radio rows are skipped like the collection resolver skips them.
 */
export function buildDashboardPortalLiveEpgEntry(
    item: PortalActivityItem
): DashboardPortalLiveEpgEntry | null {
    if (item.type !== 'live') {
        return null;
    }
    if (item.source === 'xtream') {
        return buildXtreamEntry(item);
    }
    if (item.source === 'stalker') {
        return buildStalkerEntry(item);
    }
    return null;
}

/**
 * The resolver keys its map by the item's `tvgId`; the entry sets it to the
 * provider id, so a missing key means "asked, nothing on air".
 */
export function resolveDashboardPortalLiveEpgProgram(
    epgMap: ReadonlyMap<string, EpgProgram | null>,
    entry: DashboardPortalLiveEpgEntry
): EpgProgram | null {
    const key = entry.item.tvgId?.trim();
    return key ? (epgMap.get(key) ?? null) : null;
}

/**
 * When the programme on air ends, in wall-clock milliseconds; `null` when the
 * row states no usable end. Reads the pre-computed unix-seconds field first,
 * then the ISO string, like the dashboard's own time-range helper.
 */
export function dashboardPortalLiveEpgProgramStopMs(
    program: EpgProgram | null
): number | null {
    if (!program) {
        return null;
    }
    const cached = Number(program.stopTimestamp);
    if (Number.isFinite(cached) && cached > 0) {
        return cached * 1000;
    }
    const parsed = program.stop ? Date.parse(program.stop) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

function buildXtreamEntry(
    item: PortalActivityItem
): DashboardPortalLiveEpgEntry | null {
    const xtreamId = Number(item.xtream_id);
    if (!Number.isInteger(xtreamId) || xtreamId <= 0) {
        return null;
    }
    const key = buildCollectionUid('xtream', item.playlist_id, xtreamId);
    return {
        key,
        item: {
            uid: key,
            name: item.title,
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: item.playlist_id,
            playlistName: item.playlist_name ?? 'Xtream',
            logo: item.poster_url ?? null,
            xtreamId,
            tvgId: String(xtreamId),
            categoryId: item.category_id,
        },
    };
}

function buildStalkerEntry(
    item: PortalActivityItem
): DashboardPortalLiveEpgEntry | null {
    const raw = item.stalker_item;
    if (!raw || isStalkerRadioItem(raw)) {
        return null;
    }
    // Both dashboard mappers already store the extracted portal id as `id`.
    const stalkerId = String(item.id ?? '').trim();
    if (!stalkerId) {
        return null;
    }
    const key = buildCollectionUid('stalker', item.playlist_id, stalkerId);
    return {
        key,
        item: {
            uid: key,
            name: item.title,
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: item.playlist_id,
            playlistName: item.playlist_name ?? 'Stalker',
            logo: item.poster_url ?? null,
            stalkerId,
            tvgId: stalkerId,
            stalkerCmd: raw.cmd,
            categoryId: item.category_id,
            stalkerItem: raw,
        },
    };
}
