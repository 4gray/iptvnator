import parser from 'iptv-playlist-parser';
import { createHash } from 'node:crypto';
import { createPlaylistObject } from '@iptvnator/shared/m3u-utils';

/** Keep whole-document consumers (including TV) compatible with raw uploads. */
export function legacySourceDocument(document: Record<string, unknown>) {
    if (typeof document['sourceRawM3u'] !== 'string') return document;
    const { playlist } = createPlaylistObject(
        String(document['title'] ?? ''),
        parser.parse(document['sourceRawM3u'])
    );
    // Repeated reads of one revision must preserve channel identity. Include
    // the ordinal because providers can expose several rows with the same URL.
    for (const [index, channel] of playlist!.items.entries())
        channel.id = createHash('sha256')
            .update(JSON.stringify([document['_id'], index, channel.url]))
            .digest('hex');
    return { ...document, playlist, count: playlist!.items.length };
}
