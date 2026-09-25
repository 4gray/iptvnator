import { Channel } from '@iptvnator/shared/interfaces';

/**
 * The row a channel-open handoff names.
 *
 * The URL is the contract every caller shares; the id is sent only by
 * callers that know the exact row, such as the Movies catalog. A playlist can
 * list one URL several times under different titles, artwork or headers, so
 * the id decides between them. An id that no longer matches — the playlist
 * was refreshed in between — falls back to the URL rather than opening
 * nothing.
 */
export function findM3uChannelOpenTarget(
    channels: readonly Channel[],
    url: string,
    id: string
): Channel | undefined {
    if (id) {
        const exact = channels.find(
            (channel) => channel.id === id && channel.url === url
        );
        if (exact) {
            return exact;
        }
    }
    return channels.find((channel) => channel.url === url);
}

/** Whether `channel` is already the row the handoff names. */
export function isM3uChannelOpenTarget(
    channel: Channel | null | undefined,
    url: string,
    id: string
): boolean {
    return !!channel && channel.url === url && (!id || channel.id === id);
}
