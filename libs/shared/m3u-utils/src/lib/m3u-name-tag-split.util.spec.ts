import { M3U_ENTRY_CORPUS } from './m3u-entry-corpus.spec-data';
import { splitM3uNameTag } from './m3u-name-tag-split.util';
import { stripCountryPrefix } from './strip-country-prefix.util';

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
            expect(splitM3uNameTag('TR:KANAL ORNEK 1 HD').title).toBe(
                'KANAL ORNEK 1 HD'
            );
            expect(splitM3uNameTag('|EN| Globe News').title).toBe('Globe News');
            expect(splitM3uNameTag('4K - Dry Canyon [2015]').title).toBe(
                'Dry Canyon [2015]'
            );
        });

        it('returns the name untouched when there is no tag', () => {
            expect(splitM3uNameTag('Globe News International')).toEqual({
                tag: null,
                title: 'Globe News International',
            });
        });
    });

    describe('the colon needs no trailing space', () => {
        it('splits a tag welded to the name', () => {
            expect(splitM3uNameTag('TR:KANAL ORNEK 1 HD').tag).toBe('TR');
            expect(splitM3uNameTag('DE:THE GLASS HARBOR - 2025').tag).toBe(
                'DE'
            );
        });

        it('still splits the spaced form', () => {
            expect(splitM3uNameTag('US: Globe News').tag).toBe('US');
        });

        it('takes only the first colon', () => {
            // A tagged name whose title carries its own colon must keep it.
            expect(splitM3uNameTag('TR:GECE AVCISI: BÖLÜM 2 2004')).toEqual({
                tag: 'TR',
                title: 'GECE AVCISI: BÖLÜM 2 2004',
            });
        });

        it('keeps franchise titles whose prefix is too long to be a tag', () => {
            // The 2-3 character gate is what makes dropping the space safe.
            for (const name of [
                'Mission: Improbable - Fallback',
                'KDSQ: Harbor City',
                'Starfall Saga: Episode I - The Silent Orbit',
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
    describe('agreement with the display strip', () => {
        // `stripCountryPrefix` is the title-only twin the startup path uses.
        // Both split where `findM3uTagSeparator` says; this pins that the
        // two wrappers never drift apart.
        it('yields the title stripCountryPrefix shows, for every corpus name', () => {
            for (const entry of M3U_ENTRY_CORPUS) {
                expect(splitM3uNameTag(entry.name).title).toBe(
                    stripCountryPrefix(entry.name)
                );
            }
        });

        it('agrees on the shapes that have no tag to give', () => {
            for (const name of [
                '',
                '   ',
                'US | ',
                '| Globe News',
                '|DE| Kanal',
                'Mission: Improbable - Fallback',
            ]) {
                expect(splitM3uNameTag(name).title).toBe(
                    stripCountryPrefix(name)
                );
            }
        });
    });
});
