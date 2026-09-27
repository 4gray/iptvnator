import { M3U_ENTRY_CORPUS } from './m3u-entry-corpus.spec-data';
import { splitM3uNameTag } from './m3u-name-tag.util';

describe('splitM3uNameTag', () => {
    describe('against the provider corpus', () => {
        // The corpus is the specification: every observed provider spelling
        // states the tag it must yield, so this suite fails the moment a
        // rule change stops generalizing across dialects.
        it.each(
            M3U_ENTRY_CORPUS.map(
                (entry) => [entry.name, entry.tag, entry.note] as const
            )
        )('%s → %s', (name, expected) => {
            expect(splitM3uNameTag(name).tag).toBe(expected);
        });

        it('leaves the title with the tag removed', () => {
            expect(splitM3uNameTag('TR:TRT 1 HD').title).toBe('TRT 1 HD');
            expect(splitM3uNameTag('|EN| CNN').title).toBe('CNN');
            expect(splitM3uNameTag('4K - Sicario [2015]').title).toBe(
                'Sicario [2015]'
            );
        });

        it('returns the name untouched when there is no tag', () => {
            expect(splitM3uNameTag('CNN International')).toEqual({
                tag: null,
                title: 'CNN International',
            });
        });
    });

    describe('the colon needs no trailing space', () => {
        it('splits a tag welded to the name', () => {
            expect(splitM3uNameTag('TR:TRT 1 HD').tag).toBe('TR');
            expect(splitM3uNameTag('DE:THE NAKED GUN - 2025').tag).toBe('DE');
        });

        it('still splits the spaced form', () => {
            expect(splitM3uNameTag('US: CNN').tag).toBe('US');
        });

        it('takes only the first colon', () => {
            // A tagged name whose title carries its own colon must keep it.
            expect(splitM3uNameTag('TR:KILL BILL: BÖLÜM 2 2004')).toEqual({
                tag: 'TR',
                title: 'KILL BILL: BÖLÜM 2 2004',
            });
        });

        it('keeps franchise titles whose prefix is too long to be a tag', () => {
            // The 2-3 character gate is what makes dropping the space safe.
            for (const name of [
                'Mission: Impossible - Fallout',
                'NCIS: Los Angeles',
                'Star Wars: Episode I - The Phantom Menace',
            ]) {
                expect(splitM3uNameTag(name).tag).toBeNull();
            }
        });

        it('keeps a lowercase prefix', () => {
            expect(splitM3uNameTag('news: today').tag).toBeNull();
        });
    });

    describe('degenerate input', () => {
        it('reports no tag for empty or nullish names', () => {
            for (const name of ['', '   ', null, undefined]) {
                expect(splitM3uNameTag(name).tag).toBeNull();
            }
        });

        it('reports no tag when stripping would leave nothing', () => {
            expect(splitM3uNameTag('US | ')).toEqual({
                tag: null,
                title: 'US |',
            });
        });
    });
});
