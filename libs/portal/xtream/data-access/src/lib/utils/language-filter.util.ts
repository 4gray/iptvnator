export type XtreamLanguageFilterCandidate = Record<string, unknown> & {
    readonly duplicateVariants?: readonly XtreamLanguageFilterCandidate[];
};

export type XtreamLanguageFilterSection =
    | 'audioInclude'
    | 'audioExclude'
    | 'subtitleInclude'
    | 'subtitleExclude';

export interface XtreamLanguageOption {
    code: string;
    label: string;
}

export interface XtreamLanguageFilterState {
    audioInclude: string[];
    audioExclude: string[];
    subtitleInclude: string[];
    subtitleExclude: string[];
}

export const EMPTY_XTREAM_LANGUAGE_FILTER: XtreamLanguageFilterState = {
    audioInclude: [],
    audioExclude: [],
    subtitleInclude: [],
    subtitleExclude: [],
};

export interface XtreamItemLanguageMetadata {
    audioLanguages: string[];
    subtitleLanguages: string[];
}

const LANGUAGE_LABELS: Record<string, string> = {
    ar: 'Arabo',
    de: 'Tedesco',
    en: 'Inglese',
    es: 'Spagnolo',
    fr: 'Francese',
    hi: 'Hindi',
    it: 'Italiano',
    ja: 'Giapponese',
    ko: 'Coreano',
    multi: 'Multi',
    nl: 'Olandese',
    pl: 'Polacco',
    pt: 'Portoghese',
    ru: 'Russo',
    tr: 'Turco',
    zh: 'Cinese',
};

const DEFAULT_LANGUAGE_OPTIONS: XtreamLanguageOption[] = [
    'it',
    'en',
    'es',
    'fr',
    'de',
    'pt',
    'multi',
    'ru',
    'ja',
    'ko',
    'zh',
    'pl',
    'tr',
    'nl',
    'ar',
    'hi',
].map((code) => ({
    code,
    label: LANGUAGE_LABELS[code] ?? code.toUpperCase(),
}));

const LANGUAGE_ALIASES: Record<string, string> = {
    ar: 'ar',
    ara: 'ar',
    arabic: 'ar',
    arabo: 'ar',
    chi: 'zh',
    chinese: 'zh',
    cinese: 'zh',
    cmn: 'zh',
    de: 'de',
    deu: 'de',
    ger: 'de',
    german: 'de',
    tedesco: 'de',
    dual: 'multi',
    en: 'en',
    eng: 'en',
    english: 'en',
    inglese: 'en',
    es: 'es',
    esp: 'es',
    espanol: 'es',
    spa: 'es',
    spanish: 'es',
    fr: 'fr',
    fra: 'fr',
    fre: 'fr',
    francais: 'fr',
    francese: 'fr',
    french: 'fr',
    hi: 'hi',
    hin: 'hi',
    hindi: 'hi',
    it: 'it',
    ita: 'it',
    italian: 'it',
    italiano: 'it',
    ja: 'ja',
    japanese: 'ja',
    giapponese: 'ja',
    jpn: 'ja',
    ko: 'ko',
    kor: 'ko',
    korean: 'ko',
    coreano: 'ko',
    multi: 'multi',
    multiaudio: 'multi',
    nl: 'nl',
    nld: 'nl',
    dutch: 'nl',
    olandese: 'nl',
    pl: 'pl',
    pol: 'pl',
    polish: 'pl',
    polacco: 'pl',
    por: 'pt',
    portuguese: 'pt',
    portoghese: 'pt',
    pt: 'pt',
    ru: 'ru',
    rus: 'ru',
    russian: 'ru',
    russo: 'ru',
    tr: 'tr',
    tur: 'tr',
    turkish: 'tr',
    turco: 'tr',
    zh: 'zh',
    zho: 'zh',
};

const AUDIO_VALUE_KEYS = [
    'audio',
    'audios',
    'audioLanguage',
    'audioLanguages',
    'audio_language',
    'audio_languages',
    'language',
    'languages',
    'lang',
];

const SUBTITLE_VALUE_KEYS = [
    'subtitle',
    'subtitles',
    'subtitleLanguage',
    'subtitleLanguages',
    'subtitlesLanguages',
    'subtitle_language',
    'subtitle_languages',
    'sub_language',
    'sub_languages',
    'subs',
    'text',
    'textLanguages',
];

const TITLE_KEYS = [
    'title',
    'name',
    'o_name',
    'original_name',
    'stream_display_name',
    'container_extension',
    'category_name',
];

export function getXtreamLanguageOptions(
    items: readonly XtreamLanguageFilterCandidate[],
    filter?: XtreamLanguageFilterState
): XtreamLanguageOption[] {
    const detectedCodes = new Set<string>();

    for (const item of items) {
        collectItemAndVariants(item).forEach((candidate) => {
            const metadata = getXtreamItemLanguageMetadata(candidate);
            metadata.audioLanguages.forEach((code) => detectedCodes.add(code));
            metadata.subtitleLanguages.forEach((code) =>
                detectedCodes.add(code)
            );
        });
    }

    for (const code of [
        ...(filter?.audioInclude ?? []),
        ...(filter?.audioExclude ?? []),
        ...(filter?.subtitleInclude ?? []),
        ...(filter?.subtitleExclude ?? []),
    ]) {
        detectedCodes.add(code);
    }

    const optionsByCode = new Map<string, XtreamLanguageOption>();
    for (const option of DEFAULT_LANGUAGE_OPTIONS) {
        optionsByCode.set(option.code, option);
    }
    for (const code of detectedCodes) {
        optionsByCode.set(code, {
            code,
            label: LANGUAGE_LABELS[code] ?? code.toUpperCase(),
        });
    }

    return [...optionsByCode.values()].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
}

export function matchesXtreamLanguageFilter(
    item: XtreamLanguageFilterCandidate,
    filter: XtreamLanguageFilterState
): boolean {
    if (!isXtreamLanguageFilterActive(filter)) {
        return true;
    }

    return collectItemAndVariants(item).some((candidate) =>
        matchesSingleCandidate(candidate, filter)
    );
}

export function getXtreamItemLanguageMetadata(
    item: XtreamLanguageFilterCandidate
): XtreamItemLanguageMetadata {
    const info = getRecord(item['info']);
    const mediaMetadata = getRecord(item['mediaMetadata']);
    const movieData = getRecord(item['movie_data']);
    const episodes = getEpisodeRecords(item['episodes']);

    const audioValues = [
        ...readKnownValues(item, AUDIO_VALUE_KEYS),
        ...readKnownValues(info, AUDIO_VALUE_KEYS),
        ...readKnownValues(movieData, AUDIO_VALUE_KEYS),
        mediaMetadata?.['audioLanguages'],
        ...flatMapArray(episodes, (episode) => [
            ...readKnownValues(episode, AUDIO_VALUE_KEYS),
            ...readKnownValues(getRecord(episode['info']), AUDIO_VALUE_KEYS),
        ]),
    ];
    const subtitleValues = [
        ...readKnownValues(item, SUBTITLE_VALUE_KEYS),
        ...readKnownValues(info, SUBTITLE_VALUE_KEYS),
        ...readKnownValues(movieData, SUBTITLE_VALUE_KEYS),
        mediaMetadata?.['subtitleLanguages'],
        ...flatMapArray(episodes, (episode) => [
            ...readKnownValues(episode, SUBTITLE_VALUE_KEYS),
            ...readKnownValues(getRecord(episode['info']), SUBTITLE_VALUE_KEYS),
        ]),
    ];
    const titleTexts = [
        ...readKnownValues(item, TITLE_KEYS),
        ...readKnownValues(info, TITLE_KEYS),
        ...readKnownValues(movieData, TITLE_KEYS),
        ...flatMapArray(episodes, (episode) =>
            readKnownValues(episode, TITLE_KEYS)
        ),
    ];

    return {
        audioLanguages: unique([
            ...extractLanguageCodes(audioValues),
            ...extractAudioLanguageTags(titleTexts),
        ]),
        subtitleLanguages: unique([
            ...extractLanguageCodes(subtitleValues),
            ...extractSubtitleLanguageTags(titleTexts),
        ]),
    };
}

export function isXtreamLanguageFilterActive(
    filter: XtreamLanguageFilterState | null | undefined
): boolean {
    return Boolean(
        filter &&
            (filter.audioInclude.length > 0 ||
                filter.audioExclude.length > 0 ||
                filter.subtitleInclude.length > 0 ||
                filter.subtitleExclude.length > 0)
    );
}

function matchesSingleCandidate(
    item: XtreamLanguageFilterCandidate,
    filter: XtreamLanguageFilterState
): boolean {
    const metadata = getXtreamItemLanguageMetadata(item);
    return (
        matchesLanguageAxis(
            metadata.audioLanguages,
            filter.audioInclude,
            filter.audioExclude
        ) &&
        matchesLanguageAxis(
            metadata.subtitleLanguages,
            filter.subtitleInclude,
            filter.subtitleExclude
        )
    );
}

function matchesLanguageAxis(
    available: readonly string[],
    include: readonly string[],
    exclude: readonly string[]
): boolean {
    const availableSet = new Set(available);
    if (include.length > 0 && !include.some((code) => availableSet.has(code))) {
        return false;
    }

    return !exclude.some((code) => availableSet.has(code));
}

function collectItemAndVariants(
    item: XtreamLanguageFilterCandidate
): XtreamLanguageFilterCandidate[] {
    return [
        item,
        ...((item.duplicateVariants ?? []) as XtreamLanguageFilterCandidate[]),
    ];
}

function readKnownValues(
    record: Record<string, unknown> | null,
    keys: readonly string[]
): unknown[] {
    if (!record) {
        return [];
    }

    return keys.map((key) => record[key]).filter((value) => value !== undefined);
}

function getEpisodeRecords(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== 'object') {
        return [];
    }

    if (Array.isArray(value)) {
        return flatMapArray(value, (entry) =>
            getRecord(entry) ? [getRecord(entry) as Record<string, unknown>] : []
        );
    }

    return flatMapArray(Object.values(value as Record<string, unknown>), (entry) =>
        Array.isArray(entry)
            ? entry
                  .map(getRecord)
                  .filter(
                      (record): record is Record<string, unknown> =>
                          record !== null
                  )
            : []
    );
}

function extractLanguageCodes(values: readonly unknown[]): string[] {
    return unique(
        flatMapArray(values, (value) =>
            flatMapArray(collectLeafStrings(value), extractCodesFromText)
        )
    );
}

function extractAudioLanguageTags(values: readonly unknown[]): string[] {
    return unique(
        flatMapArray(values, (value) =>
            flatMapArray(collectLeafStrings(value), (text) =>
                extractLanguageTagsFromTitle(text, 'audio')
            )
        )
    );
}

function extractSubtitleLanguageTags(values: readonly unknown[]): string[] {
    return unique(
        flatMapArray(values, (value) =>
            flatMapArray(collectLeafStrings(value), (text) =>
                extractLanguageTagsFromTitle(text, 'subtitle')
            )
        )
    );
}

function extractCodesFromText(text: string): string[] {
    const normalized = normalizeText(text);
    const tokens = normalized.match(/[a-z]{2,}/g) ?? [];
    return unique(tokens.map((token) => LANGUAGE_ALIASES[token]).filter(Boolean));
}

function extractLanguageTagsFromTitle(
    text: string,
    kind: 'audio' | 'subtitle'
): string[] {
    const normalized = normalizeText(text);
    const codes = new Set<string>();

    if (/\b(?:multi|multiaudio|dual(?:\s+audio)?)\b/.test(normalized)) {
        codes.add('multi');
    }

    for (const [alias, code] of Object.entries(LANGUAGE_ALIASES)) {
        if (alias.length <= 2 && !isSafeTwoLetterTitleTag(normalized, alias)) {
            continue;
        }

        const languagePattern = escapeRegExp(alias).replace(/\\ /g, '\\s+');
        const subtitlePattern = new RegExp(
            `\\b(?:sub|subs|subtitle|subtitles|sottotitoli|vost|vose)\\s*[-_.: ]*${languagePattern}\\b`
        );

        if (kind === 'subtitle') {
            if (
                subtitlePattern.test(normalized) ||
                new RegExp(`\\bvost${languagePattern}\\b`).test(normalized)
            ) {
                codes.add(code);
            }
            continue;
        }

        const plainPattern = new RegExp(`\\b${languagePattern}\\b`);
        if (!subtitlePattern.test(normalized) && plainPattern.test(normalized)) {
            codes.add(code);
        }
    }

    return [...codes];
}

function isSafeTwoLetterTitleTag(text: string, alias: string): boolean {
    const escaped = escapeRegExp(alias);
    return new RegExp(
        `(^|[\\s\\[\\]()._|:-])${escaped}($|[\\s\\[\\]()._|:-])`
    ).test(text);
}

function collectLeafStrings(value: unknown): string[] {
    if (value === null || value === undefined) {
        return [];
    }

    if (typeof value === 'string' || typeof value === 'number') {
        return [String(value)];
    }

    if (Array.isArray(value)) {
        return flatMapArray(value, collectLeafStrings);
    }

    if (typeof value !== 'object') {
        return [];
    }

    return flatMapArray(
        Object.values(value as Record<string, unknown>),
        collectLeafStrings
    );
}

function getRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\u2019']/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unique(values: readonly (string | undefined)[]): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function flatMapArray<T, U>(
    values: readonly T[],
    mapper: (value: T) => readonly U[]
): U[] {
    return values.reduce<U[]>((items, value) => {
        items.push(...mapper(value));
        return items;
    }, []);
}
