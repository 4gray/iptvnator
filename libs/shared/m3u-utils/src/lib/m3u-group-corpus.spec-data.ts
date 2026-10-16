/**
 * Provider-dialect corpus for M3U group-tree derivation.
 *
 * `group-title` is one opaque string, so any hierarchy has to be DERIVED, and
 * providers disagree completely about how they encode it. The two families
 * below are near mirror images:
 *
 *  - A Turkish/German panel that uses **no separator at all** — its hierarchy
 *    lives in a shared leading word ("Türk …" ×26, "Deutsche …" ×21) or, for
 *    the daily-serial groups, a shared trailing word ("… Dizileri" ×7).
 *  - International panels and public playlists, which do the opposite: an
 *    explicit `|`, `/`, `▶`, ` - ` or `: ` path, or no hierarchy whatsoever.
 *
 * A rule validated only against the first family has its separator tier
 * completely untested, and a rule validated only against the second has its
 * token tiers untested. Both are therefore mandatory inputs to every
 * `buildM3uGroupTree` suite.
 *
 * Each corpus carries the tree the derivation must produce, so the rules are
 * pinned here BEFORE they are implemented. The conservation invariant —
 * every input title appears exactly once across parents and roots, and
 * nothing is invented — is asserted over these expectations themselves in
 * `m3u-corpus.spec.ts`, so a self-contradictory fixture cannot ship.
 *
 * Group titles are category names only. They carry no host, credential,
 * stream id or provider identity.
 */

/** Which tier claimed a parent. Tiers are ordered and mutually exclusive. */
export type M3uGroupParentOrigin =
    'separator' | 'leading-token' | 'trailing-token';

export interface M3uGroupParentExpectation {
    /** Rendered parent label. */
    readonly label: string;
    readonly origin: M3uGroupParentOrigin;
    /**
     * Children, each an EXACT original `group-title`. Leaves are never
     * rewritten: group hiding, per-group sort and selection all key on the
     * original string.
     */
    readonly children: readonly string[];
}

export interface M3uGroupCorpus {
    readonly id: string;
    /** What this dialect exercises that the others do not. */
    readonly description: string;
    readonly groupTitles: readonly string[];
    readonly expectedParents: readonly M3uGroupParentExpectation[];
    readonly expectedRoots: readonly string[];
}

/**
 * The 26 "Türk …" groups. Note the mix of kinds inside one family — live
 * (Ulusal, Spor, Haber), movies (Yerli Filmler, Korku) and series (Yerli
 * Dizileri) — which is why the tree is built per content kind rather than
 * over the whole playlist at once.
 */
const TURK_GROUPS = [
    'Türk Ulusal',
    'Türk Yerel',
    'Türk Haber',
    'Türk Spor',
    'Türk Müzik',
    'Türk Radyo',
    'Türk Çocuk',
    'Türk Belgesel',
    'Türk UHD',
    'Türk Yerli Dizileri',
    'Türk Yerli Filmler',
    'Türk Altyazılı Filmler',
    'Türk Belgesel Filmler',
    'Türk 3D ve Seri Filmler',
    'Türk Aksiyon & Gerilim',
    'Türk Bilim Kurgu & Fantastik',
    'Türk Romantik & Dram',
    'Türk Savaş & Tarih',
    'Türk Komedi',
    'Türk Korku',
    'Türk Macera',
    'Türk Western',
    'Türk Animasyon',
    'Türk Sinema',
    'Türk Yeşilçam',
    'Türk IMDB Top 100',
] as const;

/**
 * The 21 "Deutsche …" groups. Two traps live here:
 *  - a bare `Deutsche`, i.e. a child whose title equals its parent's label;
 *  - `Deutsche Sci-Fi/Fantasy`, whose slash would be read as a hierarchy
 *    path by a naive separator tier. It survives because a separator parent
 *    needs at least two siblings, and "Deutsche Sci-Fi" has none.
 */
const DEUTSCHE_GROUPS = [
    'Deutsche',
    'Deutsche UHD',
    'Deutsche (Amazon)',
    'Deutsche Sport',
    'Deutsche Sport (VIP)',
    'Deutsche Kinder',
    'Deutsche Dokumentation',
    'Deutsche Klassische Serien',
    'Deutsche Disney+',
    'Deutsche Neue Filme',
    'Deutsche Kino',
    'Deutsche Action',
    'Deutsche Drama',
    'Deutsche Horror',
    'Deutsche Thriller',
    'Deutsche Krimi',
    'Deutsche Komödien',
    'Deutsche Liebesfilme',
    'Deutsche Sci-Fi/Fantasy',
    'Deutsche Western',
    'Deutsche Animation',
] as const;

/** Day-of-week daily-serial groups: a shared TRAILING word, no shared head. */
const DIZILERI_GROUPS = [
    'Pazartesi Dizileri',
    'Salı Dizileri',
    'Çarşamba Dizileri',
    'Perşembe Dizileri',
    'Cuma Dizileri',
    'Cumartesi Dizileri',
    'Pazar Dizileri',
] as const;

const NETFLIX_GROUPS = [
    'Netflix Türkiye',
    'Netflix Deutschland',
    'Netflix France',
    'Netflix Çocuk',
] as const;

/**
 * Titles that stay at the root of this dialect. Most are bare country names;
 * the rest are single-word brands, plus four instructive near-misses:
 *  - `Disney+ Türkiye` loses its would-be "… Türkiye" family because every
 *    other member was already claimed by a leading-token parent;
 *  - `MULTI SERIES` and `Dini Kanallar` end in stop words;
 *  - `Adults +18` and `Ex-Yu` are single-token after the separator rules
 *    decline them.
 */
const TR_DE_ROOTS = [
    'MULTI SERIES',
    'Disney+ Türkiye',
    'BluTV',
    'Exxen',
    'Gain',
    'Tabii',
    'TOD',
    'Mubi',
    'Yeni Eklenen Filmler',
    'Adults +18',
    'Dini Kanallar',
    'Bollywood',
    'Kurdish',
    'Arabic',
    'Ex-Yu',
    'KKTC',
    'Albania',
    'Armenia',
    'Azerbaijan',
    'Belgium',
    'Brazil',
    'Canada',
    'Czech Republic',
    'Denmark',
    'España',
    'Greece',
    'Hungary',
    'India',
    'Italia',
    'Norway',
    'Poland',
    'Portugal',
    'Romania',
    'Russia',
    'Schweiz',
    'Sweden',
    'USA',
    'Ukraine',
    'United Kingdom',
    'Africa',
    'Österreich',
] as const;

const XTREAM_TR_DE: M3uGroupCorpus = {
    id: 'xtream-tr-de',
    description:
        'A Turkish/German multi-language panel: 111 groups, not one of ' +
        'which uses a hierarchy separator. The whole tree therefore comes ' +
        'from shared leading words, plus one shared trailing word. This is ' +
        'the corpus that proves the token tiers work; it proves nothing ' +
        'whatsoever about the separator tier.',
    groupTitles: [
        ...TURK_GROUPS,
        ...DEUTSCHE_GROUPS,
        ...NETFLIX_GROUPS,
        'Amazon Prime Türkiye',
        'Amazon Prime Deutschland',
        'HBO Max Türkiye',
        'HBO Max Deutschland',
        'Apple TV+ Türkiye',
        'Apple TV+ Deutschland',
        'Nederland',
        'Nederland VOD',
        'France',
        'France VOD',
        'Bulgaria',
        'Bulgaria VOD',
        ...DIZILERI_GROUPS,
        ...TR_DE_ROOTS,
    ],
    expectedParents: [
        { label: 'Türk', origin: 'leading-token', children: [...TURK_GROUPS] },
        {
            label: 'Deutsche',
            origin: 'leading-token',
            children: [...DEUTSCHE_GROUPS],
        },
        {
            label: 'Netflix',
            origin: 'leading-token',
            children: [...NETFLIX_GROUPS],
        },
        {
            // Two members only, admitted because they share TWO leading
            // tokens. A single shared token would not be enough.
            label: 'Amazon Prime',
            origin: 'leading-token',
            children: ['Amazon Prime Türkiye', 'Amazon Prime Deutschland'],
        },
        {
            label: 'HBO Max',
            origin: 'leading-token',
            children: ['HBO Max Türkiye', 'HBO Max Deutschland'],
        },
        {
            label: 'Apple TV+',
            origin: 'leading-token',
            children: ['Apple TV+ Türkiye', 'Apple TV+ Deutschland'],
        },
        {
            // Two members, admitted by the other special case: one member's
            // title IS the bucket key.
            label: 'Nederland',
            origin: 'leading-token',
            children: ['Nederland', 'Nederland VOD'],
        },
        {
            label: 'France',
            origin: 'leading-token',
            children: ['France', 'France VOD'],
        },
        {
            label: 'Bulgaria',
            origin: 'leading-token',
            children: ['Bulgaria', 'Bulgaria VOD'],
        },
        {
            label: 'Dizileri',
            origin: 'trailing-token',
            children: [...DIZILERI_GROUPS],
        },
    ],
    expectedRoots: [...TR_DE_ROOTS],
};

/**
 * The public `iptv-org` category vocabulary, fetched from
 * https://iptv-org.github.io/api/categories.json. Thirty flat single-word
 * categories with no hierarchy of any kind — the degenerate case, and the
 * most important negative test in the file: the derivation must invent
 * NOTHING here. A rule that groups these has learned the wrong lesson from
 * the dialects that do have structure.
 */
const IPTV_ORG_FLAT: M3uGroupCorpus = {
    id: 'iptv-org-flat',
    description:
        'Public playlist vocabulary: flat single-word categories, no ' +
        'hierarchy. Expected output is zero parents.',
    groupTitles: [
        'Auto',
        'Animation',
        'Business',
        'Classic',
        'Comedy',
        'Cooking',
        'Culture',
        'Documentary',
        'Education',
        'Entertainment',
        'Family',
        'General',
        'Interactive',
        'Kids',
        'Legislative',
        'Lifestyle',
        'Movies',
        'Music',
        'News',
        'Outdoor',
        'Public',
        'Relax',
        'Religious',
        'Series',
        'Science',
        'Shop',
        'Sports',
        'Travel',
        'Weather',
        'XXX',
    ],
    expectedParents: [],
    expectedRoots: [
        'Auto',
        'Animation',
        'Business',
        'Classic',
        'Comedy',
        'Cooking',
        'Culture',
        'Documentary',
        'Education',
        'Entertainment',
        'Family',
        'General',
        'Interactive',
        'Kids',
        'Legislative',
        'Lifestyle',
        'Movies',
        'Music',
        'News',
        'Outdoor',
        'Public',
        'Relax',
        'Religious',
        'Series',
        'Science',
        'Shop',
        'Sports',
        'Travel',
        'Weather',
        'XXX',
    ],
};

/**
 * The commonest international shape. Note `DE | News`: a separator parent
 * still needs two siblings, so a lone one falls through to the token tiers,
 * where a two-letter head is below the minimum length. It stays at the root
 * while `EN` and `FR` become parents — asymmetric, but deterministic, and
 * exactly what keeps a stray group from minting a one-child parent.
 */
const PIPE_SEPARATED: M3uGroupCorpus = {
    id: 'pipe-separated',
    description:
        'Explicit pipe paths, the commonest international convention. ' +
        'Exercises the separator tier, which the Turkish/German corpus ' +
        'cannot reach at all.',
    groupTitles: [
        'EN | Movies',
        'EN | Series',
        'EN | Sports',
        'EN | Kids',
        'FR | Movies',
        'FR | Sports',
        'DE | News',
    ],
    expectedParents: [
        {
            label: 'EN',
            origin: 'separator',
            children: [
                'EN | Movies',
                'EN | Series',
                'EN | Sports',
                'EN | Kids',
            ],
        },
        {
            label: 'FR',
            origin: 'separator',
            children: ['FR | Movies', 'FR | Sports'],
        },
    ],
    expectedRoots: ['DE | News'],
};

const ARROW_SEPARATED: M3uGroupCorpus = {
    id: 'arrow-separated',
    description:
        'Arrow and guillemet paths. The separator class must cover the ' +
        'decorative glyphs providers use interchangeably with the pipe.',
    groupTitles: ['USA ▶ Sports', 'USA ▶ News', 'USA ▶ Movies', 'UK » Sports'],
    expectedParents: [
        {
            label: 'USA',
            origin: 'separator',
            children: ['USA ▶ Sports', 'USA ▶ News', 'USA ▶ Movies'],
        },
    ],
    expectedRoots: ['UK » Sports'],
};

/**
 * Dash and colon paths. `Sky - Sports F1` is the guard case: a dash inside a
 * real brand name must not mint a parent, and it does not, because it has no
 * sibling. The stop-word rule is deliberately NOT applied to separator
 * parents — "Movies" is a perfectly good parent when the provider wrote the
 * path itself, even though it is a stop word for the token tiers.
 */
const DASH_AND_COLON: M3uGroupCorpus = {
    id: 'dash-and-colon',
    description:
        'Spaced-dash and colon paths, plus a brand name containing a dash.',
    groupTitles: [
        'Movies - Action',
        'Movies - Comedy',
        'Movies - Horror',
        'Sports: NFL',
        'Sports: NBA',
        'Sky - Sports F1',
    ],
    expectedParents: [
        {
            label: 'Movies',
            origin: 'separator',
            children: ['Movies - Action', 'Movies - Comedy', 'Movies - Horror'],
        },
        {
            label: 'Sports',
            origin: 'separator',
            children: ['Sports: NFL', 'Sports: NBA'],
        },
    ],
    expectedRoots: ['Sky - Sports F1'],
};

const PROVIDER_FAMILIES: M3uGroupCorpus = {
    id: 'provider-families',
    description:
        'Streaming-brand families. `DISNEY+` proves that excluding "+" as ' +
        'a SEPARATOR does not exclude it from a label.',
    groupTitles: [
        'NETFLIX - ACTION',
        'NETFLIX - COMEDY',
        'DISNEY+ | KIDS',
        'DISNEY+ | MOVIES',
        'PRIME VIDEO - DRAMA',
    ],
    expectedParents: [
        {
            label: 'NETFLIX',
            origin: 'separator',
            children: ['NETFLIX - ACTION', 'NETFLIX - COMEDY'],
        },
        {
            label: 'DISNEY+',
            origin: 'separator',
            children: ['DISNEY+ | KIDS', 'DISNEY+ | MOVIES'],
        },
    ],
    expectedRoots: ['PRIME VIDEO - DRAMA'],
};

/**
 * Non-Latin scripts. Token comparison is done on case-folded whole tokens,
 * so Cyrillic and Arabic families derive exactly like Latin ones — and the
 * RTL titles must round-trip unchanged as leaf labels.
 */
const NON_LATIN: M3uGroupCorpus = {
    id: 'non-latin',
    description: 'Cyrillic and Arabic pipe paths, including RTL text.',
    groupTitles: [
        'Россия | Спорт',
        'Россия | Новости',
        'عربية | رياضة',
        'عربية | أفلام',
    ],
    expectedParents: [
        {
            label: 'Россия',
            origin: 'separator',
            children: ['Россия | Спорт', 'Россия | Новости'],
        },
        {
            label: 'عربية',
            origin: 'separator',
            children: ['عربية | رياضة', 'عربية | أفلام'],
        },
    ],
    expectedRoots: [],
};

/**
 * Punctuation that only LOOKS like a path.
 *
 *  - `24/7 X` carries a slash, but the segment left of it has no letter, so
 *    the separator tier declines it. The leading-token tier then produces
 *    the correct label `24/7` rather than the nonsense label `24`. This is
 *    the entire reason the separator tier requires a letter.
 *  - `A-Z Channels` has an unspaced dash, which is not a separator.
 *  - `Sci-Fi/Fantasy` has a real slash but no sibling, so it stays whole.
 */
const PUNCTUATION_TRAPS: M3uGroupCorpus = {
    id: 'punctuation-traps',
    description:
        'Slashes, dashes and digits that must not be read as hierarchy.',
    groupTitles: [
        '24/7 Movies',
        '24/7 News',
        '24/7 Sports',
        'A-Z Channels',
        'Sci-Fi/Fantasy',
    ],
    expectedParents: [
        {
            label: '24/7',
            origin: 'leading-token',
            children: ['24/7 Movies', '24/7 News', '24/7 Sports'],
        },
    ],
    expectedRoots: ['A-Z Channels', 'Sci-Fi/Fantasy'],
};

/**
 * Space-separated families, which is where the stop-word rule earns or loses
 * its keep. Three contrasting triples, deliberately in one corpus so the
 * distinction cannot be satisfied by accident:
 *
 *  - `Movies …` MUST become a parent. Content-category words are ordinary
 *    family names, so they are NOT stop words in the leading-token tier.
 *    Excluding them — a tempting way to "keep the tree clean" — is exactly
 *    the failure mode that breaks English-language playlists, where
 *    `Movies X` and `Sports X` are the commonest family shapes there are.
 *  - `UHD …` MUST become a parent too. A quality word in the LEADING
 *    position names a family; the same word TRAILING ("Türk UHD") only
 *    modifies one, which is why the trailing tier excludes it and the
 *    leading tier does not.
 *  - `VOD …` must NOT. Structural non-words describe the catalog rather than
 *    the content, so a "VOD" parent carries no information its children do
 *    not already carry.
 */
const SPACE_SEPARATED_FAMILIES: M3uGroupCorpus = {
    id: 'space-separated-families',
    description:
        'Leading-token families with no separator, pinning which words may ' +
        'become a parent: content categories yes, quality words yes, ' +
        'structural non-words no.',
    groupTitles: [
        'Movies Action',
        'Movies Comedy',
        'Movies Horror',
        'UHD Movies',
        'UHD Sports',
        'UHD News',
        'VOD Action',
        'VOD Comedy',
        'VOD Drama',
    ],
    expectedParents: [
        {
            label: 'Movies',
            origin: 'leading-token',
            children: ['Movies Action', 'Movies Comedy', 'Movies Horror'],
        },
        {
            label: 'UHD',
            origin: 'leading-token',
            children: ['UHD Movies', 'UHD Sports', 'UHD News'],
        },
    ],
    expectedRoots: ['VOD Action', 'VOD Comedy', 'VOD Drama'],
};

export const M3U_GROUP_CORPORA: readonly M3uGroupCorpus[] = [
    XTREAM_TR_DE,
    IPTV_ORG_FLAT,
    PIPE_SEPARATED,
    ARROW_SEPARATED,
    DASH_AND_COLON,
    PROVIDER_FAMILIES,
    NON_LATIN,
    PUNCTUATION_TRAPS,
    SPACE_SEPARATED_FAMILIES,
];

export function groupCorpus(id: string): M3uGroupCorpus {
    const found = M3U_GROUP_CORPORA.find((corpus) => corpus.id === id);
    if (!found) {
        throw new Error(`Unknown group corpus: ${id}`);
    }
    return found;
}

/**
 * Spellings that must fold to one key when group trees from several
 * playlists are merged. Case, Turkish dotted İ and Greek tonos all have to
 * collapse; the app's shared case fold already handles them, and these pairs
 * exist so a merge that reimplements folding instead of reusing it fails.
 */
export const M3U_GROUP_FOLD_EQUIVALENCES: readonly (readonly string[])[] = [
    ['Türk Spor', 'TÜRK SPOR', 'türk spor'],
    ['Kids', 'KIDS'],
    ['İzle', 'izle'],
    ['Ελληνικά', 'ελληνικά'],
];
