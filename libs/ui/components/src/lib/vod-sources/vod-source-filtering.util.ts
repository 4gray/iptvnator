import {
    titleLanguagePrefix,
    vodSourceLanguage,
    type VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';

/**
 * Filter logic for the sources popover's chip row.
 *
 * Pure functions over descriptors so the menu component stays a thin view and
 * the composition rules (filters AND each other and the host search) can be
 * tested without a fixture.
 *
 * The language a row filters on is `vodSourceLanguage`: the stream title's
 * own prefix ("EN| Movie") when it has one, else the language its categories
 * unambiguously carry ("EN | Netflix") — both parsed guesses, both browse-only.
 */

export { titleLanguagePrefix, vodSourceLanguage };

export interface VodSourceFilterState {
    /** Keep only copies whose probe verified them reachable. */
    availableOnly: boolean;
    /** Keep only copies whose stated quality is 1080p or better. */
    hdOnly: boolean;
    /** Keep only copies carrying this language (title or category); null = all. */
    language: string | null;
}

export const EMPTY_VOD_SOURCE_FILTERS: VodSourceFilterState = {
    availableOnly: false,
    hdOnly: false,
    language: null,
};

export function hasActiveVodSourceFilters(
    filters: VodSourceFilterState
): boolean {
    return filters.availableOnly || filters.hdOnly || filters.language !== null;
}

/** Every language present in the list, in first-seen order. */
export function collectLanguagePrefixes(
    sources: readonly VodSourceDescriptor[]
): string[] {
    const languages: string[] = [];
    for (const source of sources) {
        const language = vodSourceLanguage(source);
        if (language && !languages.includes(language)) {
            languages.push(language);
        }
    }
    return languages;
}

/**
 * `1080p` → 1080. Only the `NNNp` labels both the parser and the API
 * normalization emit are readable; anything else is not a comparable quality.
 */
export function qualityPixels(value: string | undefined): number | null {
    const match = /^(\d{3,4})[pi]$/i.exec(value ?? '');
    return match ? Number(match[1]) : null;
}

/**
 * Whether one copy survives the chip filters.
 *
 * HD+ reads the quality tag whether stated or guessed — this is a browse
 * filter the user drives, not an automatic decision, and hiding a copy whose
 * own title says 1080p would make the filter look broken. "Available" is
 * stricter: only a verified probe counts, because an unchecked source must
 * never pass a filter named available.
 */
export function sourceMatchesFilters(
    source: VodSourceDescriptor,
    filters: VodSourceFilterState
): boolean {
    if (filters.availableOnly && source.probe.status !== 'ok') {
        return false;
    }

    if (filters.hdOnly) {
        const pixels = qualityPixels(source.quality?.value);
        if (pixels === null || pixels < 1080) {
            return false;
        }
    }

    if (
        filters.language !== null &&
        vodSourceLanguage(source) !== filters.language
    ) {
        return false;
    }

    return true;
}

/** True while no source has a probe verdict or one in flight. */
export function noChecksRunYet(
    sources: readonly VodSourceDescriptor[]
): boolean {
    return sources.every(
        (source) =>
            source.probe.status === 'idle' || source.probe.status === 'unknown'
    );
}
