import type { StalkerVodSource } from './models';
import type { StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { createStalkerInfo } from './stalker-vod.utils';

/** Fill sparse collection presentation without replacing playback or enriched fields. */
export function mergeStalkerDisplayInfo<T extends object>(
    current: T,
    fresh: StalkerVodSource | StalkerPortalItem
): T {
    const source = current as StalkerVodSource;
    const previous = createStalkerInfo(source);
    const info = createStalkerInfo(fresh as StalkerVodSource);
    for (const [field, value] of Object.entries(previous))
        if (
            value !== '' &&
            value != null &&
            !(field === 'name' && value === 'Unknown')
        )
            Object.assign(info, { [field]: value });
    const cover = info.movie_image || source.cover;
    return JSON.stringify(previous) === JSON.stringify(info) &&
        source.cover === cover
        ? current
        : { ...current, cover, info };
}
