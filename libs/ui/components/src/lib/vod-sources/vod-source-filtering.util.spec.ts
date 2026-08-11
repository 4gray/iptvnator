import type { VodSourceDescriptor } from '@iptvnator/shared/interfaces';
import {
    collectLanguagePrefixes,
    EMPTY_VOD_SOURCE_FILTERS,
    hasActiveVodSourceFilters,
    noChecksRunYet,
    qualityPixels,
    sourceMatchesFilters,
    titleLanguagePrefix,
} from './vod-source-filtering.util';

function source(
    overrides: Partial<VodSourceDescriptor> = {}
): VodSourceDescriptor {
    return {
        id: 'playlist-1:xtream:42',
        playlistId: 'playlist-1',
        playlistName: 'SharkTV',
        portalType: 'xtream',
        contentId: 42,
        rawTitle: 'Night of the Living Dead (1968)',
        matchConfidence: 'exact',
        year: 1968,
        isActive: false,
        isPinned: false,
        isTried: false,
        probe: { status: 'idle' },
        ...overrides,
    };
}

describe('titleLanguagePrefix', () => {
    // The full parsing matrix lives with the util in shared/interfaces;
    // this asserts the re-export still reads the classic pipe form.
    it('reads the uppercase prefix before a pipe', () => {
        expect(titleLanguagePrefix('EN| Night of the Living Dead')).toBe('EN');
        expect(titleLanguagePrefix('ALB |Some Movie')).toBe('ALB');
        expect(titleLanguagePrefix('  ru| Ночь')).toBe('RU');
        expect(titleLanguagePrefix('РУС | Фильм')).toBe('РУС');
    });

    it('rejects titles whose pipe is not a language marker', () => {
        // Five letters is a word, not a language code.
        expect(titleLanguagePrefix('NIGHT| of something')).toBeNull();
        expect(titleLanguagePrefix('Night of the Living Dead')).toBeNull();
        expect(titleLanguagePrefix('4K| Movie')).toBeNull();
        expect(titleLanguagePrefix(undefined)).toBeNull();
        expect(titleLanguagePrefix('')).toBeNull();
    });
});

describe('collectLanguagePrefixes', () => {
    it('collects unique prefixes in first-seen order', () => {
        const prefixes = collectLanguagePrefixes([
            source({ rawTitle: 'EN| A' }),
            source({ rawTitle: 'RU| B' }),
            source({ rawTitle: 'en| C' }),
            source({ rawTitle: 'No prefix' }),
        ]);
        expect(prefixes).toEqual(['EN', 'RU']);
    });

    it('includes the category-derived language of untagged titles', () => {
        const prefixes = collectLanguagePrefixes([
            source({ rawTitle: 'Plain title', categoryLanguage: 'DE' }),
            // The title prefix outranks a conflicting category language.
            source({ rawTitle: 'EN| Movie', categoryLanguage: 'RU' }),
        ]);
        expect(prefixes).toEqual(['DE', 'EN']);
    });
});

describe('qualityPixels', () => {
    it('reads NNNp labels and nothing else', () => {
        expect(qualityPixels('1080p')).toBe(1080);
        expect(qualityPixels('2160p')).toBe(2160);
        expect(qualityPixels('576i')).toBe(576);
        expect(qualityPixels('4K')).toBeNull();
        expect(qualityPixels(undefined)).toBeNull();
    });
});

describe('sourceMatchesFilters', () => {
    it('passes everything with no filters active', () => {
        expect(hasActiveVodSourceFilters(EMPTY_VOD_SOURCE_FILTERS)).toBe(false);
        expect(sourceMatchesFilters(source(), EMPTY_VOD_SOURCE_FILTERS)).toBe(
            true
        );
    });

    it('available keeps only probe-verified sources', () => {
        const filters = { ...EMPTY_VOD_SOURCE_FILTERS, availableOnly: true };
        expect(
            sourceMatchesFilters(
                source({ probe: { status: 'ok', latencyMs: 100 } }),
                filters
            )
        ).toBe(true);
        // Unchecked must never pass a filter named "available".
        for (const status of ['idle', 'unknown', 'probing', 'fail'] as const) {
            expect(
                sourceMatchesFilters(source({ probe: { status } }), filters)
            ).toBe(false);
        }
    });

    it('HD+ keeps stated or guessed quality at 1080p and above', () => {
        const filters = { ...EMPTY_VOD_SOURCE_FILTERS, hdOnly: true };
        expect(
            sourceMatchesFilters(
                source({ quality: { value: '1080p', provenance: 'api' } }),
                filters
            )
        ).toBe(true);
        expect(
            sourceMatchesFilters(
                source({ quality: { value: '2160p', provenance: 'parsed' } }),
                filters
            )
        ).toBe(true);
        expect(
            sourceMatchesFilters(
                source({ quality: { value: '720p', provenance: 'api' } }),
                filters
            )
        ).toBe(false);
        // No stated quality cannot claim to be HD.
        expect(sourceMatchesFilters(source(), filters)).toBe(false);
    });

    it('language matches the parsed title prefix', () => {
        const filters = { ...EMPTY_VOD_SOURCE_FILTERS, language: 'EN' };
        expect(
            sourceMatchesFilters(source({ rawTitle: 'EN| Movie' }), filters)
        ).toBe(true);
        expect(
            sourceMatchesFilters(source({ rawTitle: 'RU| Movie' }), filters)
        ).toBe(false);
        expect(
            sourceMatchesFilters(source({ rawTitle: 'Movie' }), filters)
        ).toBe(false);
    });

    it('language falls back to the category-derived language', () => {
        const filters = { ...EMPTY_VOD_SOURCE_FILTERS, language: 'EN' };
        expect(
            sourceMatchesFilters(
                source({ rawTitle: 'Movie', categoryLanguage: 'EN' }),
                filters
            )
        ).toBe(true);
        // A title prefix always outranks the category.
        expect(
            sourceMatchesFilters(
                source({ rawTitle: 'RU| Movie', categoryLanguage: 'EN' }),
                filters
            )
        ).toBe(false);
    });

    it('filters compose with AND', () => {
        const filters = {
            availableOnly: true,
            hdOnly: true,
            language: 'EN',
        };
        const matching = source({
            rawTitle: 'EN| Movie',
            quality: { value: '1080p', provenance: 'api' },
            probe: { status: 'ok' as const },
        });
        expect(sourceMatchesFilters(matching, filters)).toBe(true);
        expect(
            sourceMatchesFilters(
                { ...matching, probe: { status: 'idle' } },
                filters
            )
        ).toBe(false);
    });
});

describe('noChecksRunYet', () => {
    it('is true only while every probe is idle or unknown', () => {
        expect(
            noChecksRunYet([source(), source({ probe: { status: 'unknown' } })])
        ).toBe(true);
        expect(
            noChecksRunYet([source(), source({ probe: { status: 'probing' } })])
        ).toBe(false);
        expect(noChecksRunYet([source({ probe: { status: 'fail' } })])).toBe(
            false
        );
    });
});
