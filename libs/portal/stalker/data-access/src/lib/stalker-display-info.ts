import type { StalkerVodSource } from './models';
import type {
    StalkerPortalItem,
    StalkerVodInfo,
} from '@iptvnator/shared/interfaces';
import { createStalkerInfo } from './stalker-vod.utils';

function fillMissingInfo(
    current: StalkerVodInfo,
    fresh: StalkerVodInfo,
    providerOnly = false
): StalkerVodInfo {
    const info = { ...current };
    for (const [field, value] of Object.entries(fresh)) {
        if (providerOnly && field.startsWith('tmdb_')) continue;
        const existing = current[field as keyof StalkerVodInfo];
        if (
            existing === '' ||
            existing == null ||
            (field === 'name' && existing === 'Unknown')
        )
            Object.assign(info, { [field]: value });
    }
    return info;
}

/** Fill sparse collection presentation without replacing playback or enriched fields. */
export function mergeStalkerDisplayInfo<T extends object>(
    current: T,
    fresh: StalkerVodSource | StalkerPortalItem
): T {
    const source = current as StalkerVodSource;
    const previous = createStalkerInfo(source);
    const incoming = createStalkerInfo(fresh as StalkerVodSource);
    const info = fillMissingInfo(previous, incoming);
    if (previous.tmdb_provider_info) {
        info.tmdb_provider_info = fillMissingInfo(
            previous.tmdb_provider_info,
            incoming.tmdb_provider_info
                ? createStalkerInfo({ info: incoming.tmdb_provider_info })
                : incoming,
            true
        );
    }
    const cover = info.movie_image || source.cover;
    return JSON.stringify(previous) === JSON.stringify(info) &&
        source.cover === cover
        ? current
        : { ...current, cover, info };
}
