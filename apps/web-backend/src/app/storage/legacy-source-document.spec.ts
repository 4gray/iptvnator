import { legacySourceDocument } from './legacy-source-document';

describe('legacy source documents', () => {
    it('normalizes uploaded channels without replacing persisted document metadata', () => {
        const document = {
            _id: 'upload',
            title: 'Shared upload',
            favorites: ['https://media.test/live'],
            sourceRawM3u:
                '#EXTM3U\n#EXTINF:-1,One\nhttps://media.test/live\n#EXTINF:-1,Two\nhttps://media.test/live',
        };
        const result = legacySourceDocument(document);
        expect(result).toMatchObject({ ...document, count: 2 });
        const items = (
            result.playlist as { items: { id: string; name: string }[] }
        ).items;
        expect(items.map((item) => item.name)).toEqual(['One', 'Two']);
        expect(
            items.every((item) => typeof item.id === 'string' && item.id)
        ).toBe(true);
        expect(new Set(items.map((item) => item.id)).size).toBe(2);
        expect(legacySourceDocument(document)).toEqual(result);
        expect(document).not.toHaveProperty('playlist');
    });

    it('retains documents whose parsed payload is already persisted', () => {
        const document = { _id: 'url', playlist: { items: [{ id: 'saved' }] } };
        expect(legacySourceDocument(document)).toBe(document);
    });
});
