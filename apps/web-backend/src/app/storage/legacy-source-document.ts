import parser from 'iptv-playlist-parser';

/** Keep whole-document consumers (including TV) compatible with raw uploads. */
export function legacySourceDocument(document: Record<string, unknown>) {
    if (typeof document['sourceRawM3u'] !== 'string') return document;
    const playlist = parser.parse(document['sourceRawM3u']);
    return { ...document, playlist, count: playlist.items.length };
}
