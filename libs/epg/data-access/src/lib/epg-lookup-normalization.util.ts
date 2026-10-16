import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';
import { EpgLookupOptions } from './epg-runtime-bridge.service';

/** Trimmed, de-duplicated, non-empty channel ids, in request order. */
export function normalizeLookupChannelIds(channelIds: string[]): string[] {
    return Array.from(
        new Set(
            channelIds
                .map((channelId) => channelId.trim())
                .filter((channelId) => channelId.length > 0)
        )
    );
}

/** The caller's declared XMLTV scope, normalized like every stored URL. */
export function normalizeLookupSourceUrls(
    options?: EpgLookupOptions
): string[] {
    return normalizeEpgUrls(options?.sourceUrls ?? []);
}
