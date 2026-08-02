import type { VodSourceDescriptor } from '@iptvnator/shared/interfaces';

/**
 * Filter logic for the sources popover's chip row.
 *
 * Pure functions over descriptors so the menu component stays a thin view and
 * the composition rules (filters AND each other and the host search) can be
 * tested without a fixture.
 */

export interface VodSourceFilterState {
    /** Keep only copies whose probe verified them reachable. */
    availableOnly: boolean;
    /** Keep only copies whose stated quality is 1080p or better. */
    hdOnly: boolean;
    /** Keep only copies carrying this title language prefix; null = all. */
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

/**
 * `EN| Night of the Living Dead` → `EN`.
 *
 * Providers prefix the raw stream title with a short uppercase language tag
 * before a pipe; that convention is the only language signal most panels
 * emit. Anything longer than four letters is a title that happens to contain
 * a pipe, not a language.
 */
export function titleLanguagePrefix(
    rawTitle: string | null | undefined
): string | null {
    const match = /^\s*([A-Za-z]{2,4})\s*\|/.exec(rawTitle ?? '');
    return match ? match[1].toUpperCase() : null;
}

/** Every language prefix present in the list, in first-seen order. */
export function collectLanguagePrefixes(
    sources: readonly VodSourceDescriptor[]
): string[] {
    const languages: string[] = [];
    for (const source of sources) {
        const language = titleLanguagePrefix(source.rawTitle);
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
        titleLanguagePrefix(source.rawTitle) !== filters.language
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
