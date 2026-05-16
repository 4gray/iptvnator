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

type LanguageDisplayNames = {
    of(code: string): string | undefined;
};

const DEFAULT_LANGUAGE_CODES = [
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
] as const;

const MULTI_LANGUAGE_LABELS: Record<string, string> = {
    ar: 'متعدد',
    'ar-MA': 'متعدد',
    be: 'Некалькі',
    de: 'Mehrsprachig',
    el: 'Πολλαπλές',
    en: 'Multiple',
    es: 'Múltiple',
    fr: 'Multiple',
    it: 'Multipla',
    ja: '複数',
    ko: '다중',
    nl: 'Meerdere',
    pl: 'Wiele języków',
    pt: 'Múltiplo',
    ru: 'Несколько',
    tr: 'Çoklu',
    zh: '多语言',
    'zh-Hant': '多語言',
};

const displayNamesByLocale = new Map<string, LanguageDisplayNames>();

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

interface LanguageAliasPattern {
    alias: string;
    code: string;
    safeTwoLetterPattern?: RegExp;
    plainPattern: RegExp;
    subtitlePattern: RegExp;
    vostPattern: RegExp;
}

const LANGUAGE_ALIAS_PATTERNS: LanguageAliasPattern[] = Object.entries(
    LANGUAGE_ALIASES
).map(([alias, code]) => {
    const languagePattern = escapeRegExp(alias).replace(/\\ /g, '\\s+');
    return {
        alias,
        code,
        safeTwoLetterPattern:
            alias.length <= 2
                ? new RegExp(
                      `(^|[\\s\\[\\]()._|:-])${languagePattern}($|[\\s\\[\\]()._|:-])`
                  )
                : undefined,
        plainPattern: new RegExp(`\\b${languagePattern}\\b`),
        subtitlePattern: new RegExp(
            `\\b(?:sub|subs|subtitle|subtitles|sottotitoli|vost|vose)\\s*[-_.: ]*${languagePattern}\\b`
        ),
        vostPattern: new RegExp(`\\bvost${languagePattern}\\b`),
    };
});

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

const ITEM_LANGUAGE_METADATA_CACHE = new WeakMap<
    XtreamLanguageFilterCandidate,
    XtreamItemLanguageMetadata
>();

export function getXtreamLanguageOptions(
    items: readonly XtreamLanguageFilterCandidate[],
    filter?: XtreamLanguageFilterState,
    locale?: string
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

    return getXtreamLanguageOptionsFromCodes(detectedCodes, filter, locale);
}

export function getXtreamLanguageOptionsFromCodes(
    codes: Iterable<string>,
    filter?: XtreamLanguageFilterState,
    locale?: string
): XtreamLanguageOption[] {
    const normalizedLocale = normalizeLanguageLabelLocale(locale);
    const detectedCodes = new Set<string>();
    for (const code of codes) {
        const normalizedCode = code.trim().toLowerCase();
        if (normalizedCode) {
            detectedCodes.add(normalizedCode);
        }
    }

    for (const code of [
        ...(filter?.audioInclude ?? []),
        ...(filter?.subtitleInclude ?? []),
    ]) {
        const normalizedCode = code.trim().toLowerCase();
        if (normalizedCode) {
            detectedCodes.add(normalizedCode);
        }
    }

    const optionsByCode = new Map<string, XtreamLanguageOption>();
    for (const code of DEFAULT_LANGUAGE_CODES) {
        optionsByCode.set(code, {
            code,
            label: getXtreamLanguageLabel(code, normalizedLocale),
        });
    }
    for (const code of detectedCodes) {
        optionsByCode.set(code, {
            code,
            label: getXtreamLanguageLabel(code, normalizedLocale),
        });
    }

    return [...optionsByCode.values()].sort((a, b) =>
        a.label.localeCompare(b.label, normalizedLocale, {
            sensitivity: 'base',
        })
    );
}

export function getXtreamLanguageLabel(code: string, locale?: string): string {
    const normalizedCode = normalizeLanguageCode(code);
    if (!normalizedCode) {
        return code.toUpperCase();
    }

    const normalizedLocale = normalizeLanguageLabelLocale(locale);
    if (normalizedCode === 'multi') {
        return (
            MULTI_LANGUAGE_LABELS[normalizedLocale] ??
            MULTI_LANGUAGE_LABELS[normalizedLocale.split('-')[0]] ??
            MULTI_LANGUAGE_LABELS.en
        );
    }

    try {
        return (
            getDisplayNames(normalizedLocale).of(
                normalizeDisplayLanguageCode(normalizedCode)
            ) ?? normalizedCode.toUpperCase()
        );
    } catch {
        return normalizedCode.toUpperCase();
    }
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
    const cached = ITEM_LANGUAGE_METADATA_CACHE.get(item);
    if (cached) {
        return cached;
    }

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

    const metadata = {
        audioLanguages: unique([
            ...extractLanguageCodes(audioValues),
            ...extractAudioLanguageTags(titleTexts),
        ]),
        subtitleLanguages: unique([
            ...extractLanguageCodes(subtitleValues),
            ...extractSubtitleLanguageTags(titleTexts),
        ]),
    };
    ITEM_LANGUAGE_METADATA_CACHE.set(item, metadata);
    return metadata;
}

export function isXtreamLanguageFilterActive(
    filter: XtreamLanguageFilterState | null | undefined
): boolean {
    return Boolean(
        filter &&
        (filter.audioInclude.length > 0 || filter.subtitleInclude.length > 0)
    );
}

function normalizeLanguageCode(code: string): string {
    return String(code ?? '')
        .trim()
        .toLowerCase();
}

function normalizeLanguageLabelLocale(locale?: string): string {
    const normalized = normalizeLanguageCode(locale ?? 'en').replace('_', '-');
    if (!normalized) {
        return 'en';
    }

    if (normalized === 'zhtw' || normalized === 'zh-tw') {
        return 'zh-Hant';
    }

    if (normalized === 'ary') {
        return 'ar-MA';
    }

    if (normalized === 'by') {
        return 'be';
    }

    return normalized;
}

function normalizeDisplayLanguageCode(code: string): string {
    if (code === 'zhtw' || code === 'zh-tw') {
        return 'zh-Hant';
    }

    if (code === 'ary') {
        return 'ar-MA';
    }

    if (code === 'by') {
        return 'be';
    }

    return code;
}

function getDisplayNames(locale: string): LanguageDisplayNames {
    const existing = displayNamesByLocale.get(locale);
    if (existing) {
        return existing;
    }

    const displayNamesConstructor = (
        Intl as typeof Intl & {
            DisplayNames?: new (
                locales: string[],
                options: { type: 'language' }
            ) => LanguageDisplayNames;
        }
    ).DisplayNames;
    const created = displayNamesConstructor
        ? new displayNamesConstructor([locale], { type: 'language' })
        : { of: (code: string) => code.toUpperCase() };
    displayNamesByLocale.set(locale, created);
    return created;
}

function matchesSingleCandidate(
    item: XtreamLanguageFilterCandidate,
    filter: XtreamLanguageFilterState
): boolean {
    const metadata = getXtreamItemLanguageMetadata(item);
    return (
        matchesLanguageAxis(metadata.audioLanguages, filter.audioInclude) &&
        matchesLanguageAxis(metadata.subtitleLanguages, filter.subtitleInclude)
    );
}

function matchesLanguageAxis(
    available: readonly string[],
    include: readonly string[]
): boolean {
    const availableSet = new Set(available);
    if (include.length > 0 && !include.some((code) => availableSet.has(code))) {
        return false;
    }

    return true;
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

    return keys
        .map((key) => record[key])
        .filter((value) => value !== undefined);
}

function getEpisodeRecords(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== 'object') {
        return [];
    }

    if (Array.isArray(value)) {
        return flatMapArray(value, (entry) =>
            getRecord(entry)
                ? [getRecord(entry) as Record<string, unknown>]
                : []
        );
    }

    return flatMapArray(
        Object.values(value as Record<string, unknown>),
        (entry) =>
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
    return unique(
        tokens.map((token) => LANGUAGE_ALIASES[token]).filter(Boolean)
    );
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

    for (const pattern of LANGUAGE_ALIAS_PATTERNS) {
        if (
            pattern.safeTwoLetterPattern &&
            !pattern.safeTwoLetterPattern.test(normalized)
        ) {
            continue;
        }

        if (kind === 'subtitle') {
            if (
                pattern.subtitlePattern.test(normalized) ||
                pattern.vostPattern.test(normalized)
            ) {
                codes.add(pattern.code);
            }
            continue;
        }

        if (
            !pattern.subtitlePattern.test(normalized) &&
            pattern.plainPattern.test(normalized)
        ) {
            codes.add(pattern.code);
        }
    }

    return [...codes];
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
    return [
        ...new Set(values.filter((value): value is string => Boolean(value))),
    ];
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
