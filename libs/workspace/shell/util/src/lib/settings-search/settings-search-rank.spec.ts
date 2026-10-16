import { rankSearchMatch, tokenizeSearchQuery } from './settings-search-rank';

describe('tokenizeSearchQuery', () => {
    it('folds case and splits on whitespace', () => {
        expect(tokenizeSearchQuery('  Video   PLAYER ')).toEqual([
            'video',
            'player',
        ]);
    });

    it('returns no tokens for a blank query', () => {
        expect(tokenizeSearchQuery('   ')).toEqual([]);
    });

    it('folds the Turkish dotted capital I like the list filters do', () => {
        expect(tokenizeSearchQuery('İnşaat')).toEqual(['inşaat']);
    });
});

describe('rankSearchMatch', () => {
    const rank = (
        query: string,
        fields: Parameters<typeof rankSearchMatch>[1]
    ) => rankSearchMatch(tokenizeSearchQuery(query), fields);

    it('returns 0 without tokens or without a match', () => {
        expect(rank('', { label: 'Theme' })).toBe(0);
        expect(rank('volume', { label: 'Theme', keywords: ['dark'] })).toBe(0);
    });

    it('requires every token to match somewhere', () => {
        const fields = {
            label: 'Video player',
            keywords: ['mpv'],
            context: ['Playback'],
        };

        expect(rank('player mpv', fields)).toBeGreaterThan(0);
        expect(rank('player vlc', fields)).toBe(0);
    });

    it('ranks label prefix over word start over inner substring', () => {
        const prefix = rank('play', { label: 'Playback bar' });
        const wordStart = rank('play', { label: 'External playback bar' });
        const inner = rank('play', { label: 'Autoplay' });

        expect(prefix).toBeGreaterThan(wordStart);
        expect(wordStart).toBeGreaterThan(inner);
        expect(inner).toBeGreaterThan(0);
    });

    it('prefers a word-start occurrence that follows an inner one', () => {
        const laterWordStart = rank('art', { label: 'Smart artplayer' });

        expect(laterWordStart).toBe(rank('art', { label: 'x artplayer' }));
        expect(laterWordStart).toBeGreaterThan(rank('art', { label: 'Smart' }));
    });

    it('weights label hits over keywords over context', () => {
        const label = rank('dark', { label: 'Dark mode' });
        const keyword = rank('dark', { label: 'Theme', keywords: ['dark'] });
        const context = rank('dark', {
            label: 'Theme',
            context: ['dark or light'],
        });

        expect(label).toBeGreaterThan(keyword);
        expect(keyword).toBeGreaterThan(context);
        expect(context).toBeGreaterThan(0);
    });

    it('rewards the whole query as a label phrase', () => {
        const phrase = rank('video player', { label: 'Video player' });
        const scattered = rank('video player', {
            label: 'Player',
            keywords: ['video'],
        });

        expect(phrase).toBeGreaterThan(scattered);
    });

    it('matches case-insensitively, accented letters included', () => {
        expect(rank('epg', { label: 'EPG sources' })).toBeGreaterThan(0);
        expect(rank('ÉPG', { label: 'épg' })).toBeGreaterThan(0);
    });
});
