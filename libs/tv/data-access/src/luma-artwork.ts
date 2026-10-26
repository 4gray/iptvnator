import { lumaArtwork, type Media, type UserData } from '@iptvnator/tv/util';
import { storedMediaPoster } from './stored-artwork';

export const channelArtworkKey = (name: string) =>
    name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
/** Exact channel names only: regional/HD variants must not acquire another channel's logo. */
export function lumaChannelLogos(documents: unknown[]): Map<string, string> {
    const logos = new Map<string, string>();
    for (const document of documents) {
        const doc = document as {
            playlist?: { items?: unknown };
            items?: unknown;
        } | null;
        const items = doc?.playlist?.items ?? doc?.items;
        if (!Array.isArray(items)) continue;
        for (const raw of items) {
            if (!raw || typeof raw.name !== 'string') continue;
            const url = lumaArtwork(raw.tvg?.logo);
            const key = channelArtworkKey(raw.name);
            if (url && !logos.has(key)) logos.set(key, url);
        }
    }
    return logos;
}
export function lumaPoster(
    item: Media,
    data: UserData,
    logos: Map<string, string>
) {
    return (
        lumaArtwork(
            storedMediaPoster(
                item,
                data.sources.find((s) => s.id === item.sourceId)
            )
        ) ??
        (item.kind === 'live'
            ? logos.get(channelArtworkKey(item.title))
            : undefined)
    );
}
