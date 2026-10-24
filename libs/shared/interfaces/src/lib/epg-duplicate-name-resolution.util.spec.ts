import {
    collectAmbiguousXmltvIds,
    resolveUniqueActiveDuplicateNames,
} from './epg-duplicate-name-resolution.util';

const guide = [
    { id: 'playlist.ligtvtr.a', displayName: 'BEINSPORTS 1 HD' },
    { id: 'playlist.ligtvtr.b', displayName: 'BEINSPORTS 1 HD' },
    { id: 'playlist.ligtvtr.c', displayName: 'BEINSPORTS 1 HD' },
    { id: 'epg.a2', displayName: 'A2 HD' },
];

describe('safe duplicate EPG resolution', () => {
    it('collects only ambiguous candidates for names used in this playlist', () => {
        expect(collectAmbiguousXmltvIds(
            guide, new Set(['beinsports 1 hd', 'a2 hd']),
        )).toEqual(['playlist.ligtvtr.a', 'playlist.ligtvtr.b', 'playlist.ligtvtr.c']);
        expect(collectAmbiguousXmltvIds(guide, new Set(['a2 hd']))).toEqual([]);
    });
    it('resolves exactly one currently active schedule', () => {
        expect(resolveUniqueActiveDuplicateNames(
            guide, new Set(['playlist.ligtvtr.b'])
        ).get('beinsports 1 hd')).toBe('playlist.ligtvtr.b');
    });
    it('never guesses when multiple or no candidate IDs are active', () => {
        expect(resolveUniqueActiveDuplicateNames(
            guide, new Set(['playlist.ligtvtr.a', 'playlist.ligtvtr.c'])
        ).has('beinsports 1 hd')).toBe(false);
        expect(resolveUniqueActiveDuplicateNames(
            guide, new Set(),
        ).has('beinsports 1 hd')).toBe(false);
    });
    it('ignores exact duplicate channel rows as a single candidate', () => {
        const repeated = [
            ...guide,
            { id: 'playlist.ligtvtr.b', displayName: 'BEINSPORTS 1 HD' },
        ];
        expect(collectAmbiguousXmltvIds(repeated)).toHaveLength(3);
        expect(resolveUniqueActiveDuplicateNames(
            repeated, new Set(['playlist.ligtvtr.b']),
        ).get('beinsports 1 hd')).toBe('playlist.ligtvtr.b');
    });
    it('is case-insensitive but never fuzzy-matches unrelated channels', () => {
        expect(resolveUniqueActiveDuplicateNames(
            guide, new Set(['PLAYLIST.LIGTVTR.B']),
        ).get('beinsports 1 hd')).toBe('playlist.ligtvtr.b');
        expect(resolveUniqueActiveDuplicateNames(
            guide, new Set(['epg.a2']),
        ).has('beinsports 1 hd')).toBe(false);
    });
});
