/**
 * Provider-dialect corpus for M3U catalog derivation: entry names and URL
 * shapes, with the classification every derivation rule must produce.
 *
 * WHY THIS FILE EXISTS
 *
 * The catalog rules (content-kind classification, episode parsing, leading
 * language-tag stripping) are heuristics over provider free text. A rule
 * tuned against one provider's spelling silently breaks another's, and unit
 * tests written from the same head that wrote the rule reproduce the same
 * blind spot. So the corpus is the specification: it is authored FIRST, from
 * observed provider output, and every rule is measured against all of it.
 *
 * Two dialect families are represented on purpose, because they disagree
 * about almost everything:
 *
 *  - `xtream-tr-de`: a Turkish/German multi-language panel. Names carry a
 *    tight `XX:` prefix with NO space after the colon, episodes are written
 *    `S1 E1` (spaced) or Turkish `5.BÖLÜM`, and content kind is legible from
 *    the Xtream `/live|/movie|/series/` path segment.
 *  - `international`: the English-language conventions most other panels and
 *    public playlists use — `US| `, `UK: `, `|EN| ` prefixes, `S01E01` and
 *    `1x02` episode codes, `Title (2024)` movies, and plain HLS URLs with no
 *    path evidence at all.
 *
 * No entry carries a real host, credential, token or stream id. Every URL is
 * a SHAPE: `provider.example` is reserved by RFC 2606, and the Xtream-style
 * `/<user>/<pass>/` positions hold literal placeholders.
 */

/** Content kind a catalog entry resolves to. */
export type M3uCorpusKind = 'live' | 'movie' | 'episode' | 'radio';

/** Expected output of episode parsing for an `episode` entry. */
export interface M3uCorpusEpisode {
    /** Series title after the marker and everything after it is removed. */
    readonly seriesTitle: string;
    readonly season: number;
    readonly episode: number;
    /**
     * False when the name carried no season at all and the season number
     * above is the "default to 1" rule rather than something the provider
     * stated. TMDB season lookups must consult the season-marker helper
     * instead of blindly asking for season 1.
     */
    readonly hasExplicitSeason: boolean;
}

export interface M3uCorpusEntry {
    /** Dialect family this entry was observed in. */
    readonly dialect: 'xtream-tr-de' | 'international';
    /** `#EXTINF` display name, exactly as the provider writes it. */
    readonly name: string;
    /** `group-title` value the entry sits under. */
    readonly group: string;
    /** URL shape — never a real endpoint. */
    readonly url: string;
    /** `radio` attribute, present only when the provider sets it. */
    readonly radio?: 'true';
    /** Kind `classifyM3uEntry` must return. */
    readonly kind: M3uCorpusKind;
    /**
     * Leading tag `splitM3uNameTag` must strip, or null when the name has
     * none. This is the token, not the separator: `TR:TRT 1` and `US| ESPN`
     * both yield a tag, `Ocean's 11` does not.
     */
    readonly tag: string | null;
    /** Required exactly when `kind` is `episode`. */
    readonly episode?: M3uCorpusEpisode;
    /** What this case pins down. Read it before changing the expectation. */
    readonly note: string;
}

const XT = 'http://provider.example';
/** Xtream-shaped path: the two segments after the kind are user/password. */
const xtream = (kind: string, id: string) => `${XT}/${kind}/user/pass/${id}`;

/**
 * Live entries. The through-line: a live stream must survive every naming
 * accident. Rule order puts the `/live/` path segment and the streaming
 * containers ahead of every name-derived signal precisely because a false
 * positive here swaps the EPG zone away from a working channel, while a
 * false negative only leaves today's layout in place.
 */
const LIVE_ENTRIES: readonly M3uCorpusEntry[] = [
    {
        dialect: 'xtream-tr-de',
        name: 'TR:TRT 1 HD',
        group: 'Türk Ulusal',
        url: xtream('live', '1001.ts'),
        kind: 'live',
        tag: 'TR',
        note: 'Tight colon prefix: no space after the colon. This is the shape the display-level stripper misses today.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'TR:TRT 1 HD [YEDEK]',
        group: 'Türk Ulusal',
        url: xtream('live', '1002.ts'),
        kind: 'live',
        tag: 'TR',
        note: 'Backup variant of the row above; the bracketed flag is a variant axis, never part of the base name.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'DE:NAT GEO WILD UHD',
        group: 'Deutsche UHD',
        url: xtream('live', '1003.ts'),
        kind: 'live',
        tag: 'DE',
        note: 'Same channel as the next row at a different quality, and filed under a DIFFERENT group — variant collapse therefore cannot be a within-group operation.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'DE:NAT GEO WILD HD',
        group: 'Deutsche',
        url: xtream('live', '1004.ts'),
        kind: 'live',
        tag: 'DE',
        note: 'Quality-tier sibling of the row above.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'MTV S1 E1',
        group: 'Deutsche',
        url: xtream('live', '1005.ts'),
        kind: 'live',
        tag: null,
        note: 'THE path guard: a live stream whose name happens to carry an episode code must never leave the live layout.',
    },
    {
        dialect: 'international',
        name: 'US| ESPN HD',
        group: 'US | Sports',
        url: xtream('live', '2001.ts'),
        kind: 'live',
        tag: 'US',
        note: 'Pipe prefix with no space before the separator.',
    },
    {
        dialect: 'international',
        name: 'UK: Sky Sports Main Event FHD',
        group: 'UK | Sports',
        url: xtream('live', '2002.ts'),
        kind: 'live',
        tag: 'UK',
        note: 'Colon prefix WITH a space, and a long real channel name behind it.',
    },
    {
        dialect: 'international',
        name: '|EN| CNN',
        group: 'EN | News',
        url: xtream('live', '2003.ts'),
        kind: 'live',
        tag: 'EN',
        note: 'Wrapped tag form.',
    },
    {
        dialect: 'international',
        name: 'EN - BBC One',
        group: 'EN | Entertainment',
        url: xtream('live', '2004.ts'),
        kind: 'live',
        tag: 'EN',
        note: 'Spaced-dash prefix.',
    },
    {
        dialect: 'international',
        name: '[VIP] beIN Sports 1',
        group: 'Sports: Premium',
        url: xtream('live', '2005.ts'),
        kind: 'live',
        tag: null,
        note: 'A bracketed flag is not a language tag; nothing may be stripped as one.',
    },
    {
        dialect: 'international',
        name: 'CNN International',
        group: 'News',
        url: `${XT}/hls/cnn-international/index.m3u8`,
        kind: 'live',
        tag: null,
        note: 'Plain HLS with no Xtream path evidence — the shape most public playlists use. Falls through to the live default.',
    },
    {
        dialect: 'international',
        name: 'Sky - Sports F1',
        group: 'UK | Sports',
        url: `${XT}/hls/sky-sports-f1/index.m3u8`,
        kind: 'live',
        tag: null,
        note: 'A dash inside a real channel name. "Sky" is a brand, not a country tag, so nothing is stripped.',
    },
    {
        dialect: 'international',
        name: 'Rai 1',
        group: 'Italia',
        url: `${XT}/dash/rai-1/manifest.mpd`,
        kind: 'live',
        tag: null,
        note: 'DASH has its own routing path and is never VOD.',
    },
];

/**
 * Radio. The `radio` attribute is checked before any URL evidence, matching
 * the audio-player gate the app already applies.
 */
const RADIO_ENTRIES: readonly M3uCorpusEntry[] = [
    {
        dialect: 'xtream-tr-de',
        name: 'TR:TRT RADYO 1',
        group: 'Türk Radyo',
        url: xtream('live', '1101.ts'),
        radio: 'true',
        kind: 'radio',
        tag: 'TR',
        note: 'The attribute wins over every URL signal.',
    },
];

/**
 * Movies. The hard cases are all names that LOOK like episodes: Turkish film
 * series write "BÖLÜM 2" where English writes "Part 2", and numbered titles
 * ("Cars 2", "Ocean's 11", "4x4") collide with episode-code shapes.
 */
const MOVIE_ENTRIES: readonly M3uCorpusEntry[] = [
    {
        dialect: 'xtream-tr-de',
        name: 'TR:DAYI: BIR ADAMIN HIKAYESI 2 - 2025',
        group: 'Türk Yerli Filmler',
        url: xtream('movie', '3001.mp4'),
        kind: 'movie',
        tag: 'TR',
        note: 'Tag prefix plus a colon INSIDE the title plus a trailing year. Only the leading tag may be stripped.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'DE:THE NAKED GUN - 2025',
        group: 'Deutsche Action',
        url: xtream('movie', '3002.mkv'),
        kind: 'movie',
        tag: 'DE',
        note: 'Trailing "- YYYY" is the dominant movie spelling in this dialect.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'TR:KILL BILL: BÖLÜM 2 2004',
        group: 'Türk 3D ve Seri Filmler',
        url: xtream('movie', '3003.mp4'),
        kind: 'movie',
        tag: 'TR',
        note: 'WEAK marker: Turkish "Bölüm 2" here means "Part 2" of a film series. Word-first BÖLÜM must NOT promote a /movie/ row to an episode.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'TR:ACLIK OYUNLARI: ALAYCI KUS - BÖLÜM 1 2014',
        group: 'Türk Bilim Kurgu & Fantastik',
        url: xtream('movie', '3004.mp4'),
        kind: 'movie',
        tag: 'TR',
        note: 'Second weak-marker witness, so the rule cannot be satisfied by special-casing one title.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'TR:OPEN SEASON 3 2010',
        group: 'Türk Animasyon',
        url: xtream('movie', '3005.mp4'),
        kind: 'movie',
        tag: 'TR',
        note: '"SEASON 3" is part of the film name. A season word alone is not episode evidence under /movie/.',
    },
    {
        dialect: 'international',
        name: 'Star Wars: Episode I - The Phantom Menace',
        group: 'Movies - Action',
        url: xtream('movie', '4001.mkv'),
        kind: 'movie',
        tag: null,
        note: 'The English counterpart of the weak-marker trap.',
    },
    {
        dialect: 'international',
        name: 'Dune (2021)',
        group: 'Movies - Action',
        url: xtream('movie', '4002.mkv'),
        kind: 'movie',
        tag: null,
        note: 'Parenthesised year, the most common international movie spelling.',
    },
    {
        dialect: 'international',
        name: '4K - Sicario [2015]',
        group: 'Movies - Action',
        url: xtream('movie', '4003.mkv'),
        kind: 'movie',
        tag: '4K',
        note: 'A quality tag occupies the same leading position as a language tag and is stripped the same way.',
    },
    {
        dialect: 'international',
        name: 'Ocean’s 11',
        group: 'Movies - Comedy',
        url: xtream('movie', '4004.mp4'),
        kind: 'movie',
        tag: null,
        note: 'A trailing number is part of the title. Typographic apostrophe on purpose.',
    },
    {
        dialect: 'international',
        name: 'Cars 2',
        group: 'Kids',
        url: xtream('movie', '4005.mp4'),
        kind: 'movie',
        tag: null,
        note: 'Shortest possible numbered-sequel title.',
    },
    {
        dialect: 'international',
        name: '4x4',
        group: 'Movies - Action',
        url: xtream('movie', '4006.mp4'),
        kind: 'movie',
        tag: null,
        note: 'The cross-episode code requires a 2-3 digit episode part precisely so this film title survives.',
    },
    {
        dialect: 'international',
        name: 'Nine Perfect Strangers',
        group: 'Movies - Drama',
        url: `${XT}/vod/user/pass/4007`,
        kind: 'movie',
        tag: null,
        note: 'The /vod/ segment carries the kind even with no file extension at all.',
    },
];

/**
 * Episodes. Both dialects are represented at full strength because the
 * 40k-row collapse that makes a series catalog possible lives or dies here.
 */
const EPISODE_ENTRIES: readonly M3uCorpusEntry[] = [
    {
        dialect: 'xtream-tr-de',
        name: 'BLACK MIRROR S1 E1',
        group: 'Netflix Türkiye',
        url: xtream('series', '5001.mp4'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'BLACK MIRROR',
            season: 1,
            episode: 1,
            hasExplicitSeason: true,
        },
        note: 'Spaced S/E form, single digits — the dominant spelling in this dialect.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'TR:MODERN FAMILY 2009 S2 E14',
        group: 'Netflix Türkiye',
        url: xtream('series', '5002.mp4'),
        kind: 'episode',
        tag: 'TR',
        episode: {
            seriesTitle: 'TR:MODERN FAMILY 2009',
            season: 2,
            episode: 14,
            hasExplicitSeason: true,
        },
        note: 'Episode parsing keeps the leading tag — stripping it is a separate rule with its own persisted consequences. The year is stripped later by the title normalizer, so this row merges with an unyeared sibling under the SAME tag only.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'DE:MODERN FAMILY S2 E14',
        group: 'Netflix Deutschland',
        url: xtream('series', '5003.mp4'),
        kind: 'episode',
        tag: 'DE',
        episode: {
            seriesTitle: 'DE:MODERN FAMILY',
            season: 2,
            episode: 14,
            hasExplicitSeason: true,
        },
        note: 'Same show as the row above in another dub. These must stay TWO series: merging them would interleave two audio languages inside one season.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'THE BAD BATCH S01 E01',
        group: 'Deutsche Disney+',
        url: xtream('movie', '5004.mp4'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'THE BAD BATCH',
            season: 1,
            episode: 1,
            hasExplicitSeason: true,
        },
        note: 'STRONG code under a /movie/ path: providers do dump whole series there, so the code promotes the row.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'DELIKANLI 5.BÖLÜM',
        group: 'Pazartesi Dizileri',
        url: xtream('movie', '5005.mp4'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'DELIKANLI',
            season: 1,
            episode: 5,
            hasExplicitSeason: false,
        },
        note: 'Turkish daily serial: number-first BÖLÜM at the END of the name, no season anywhere, served under /movie/. Without this rule these collapse into thousands of loose movie rows.',
    },
    {
        dialect: 'xtream-tr-de',
        name: 'UZAK SEHIR 60.BÖLÜM',
        group: 'Pazartesi Dizileri',
        url: xtream('movie', '5006.mp4'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'UZAK SEHIR',
            season: 1,
            episode: 60,
            hasExplicitSeason: false,
        },
        note: 'Two-digit episode in the same shape, past the point a single-digit-only rule would cover.',
    },
    {
        dialect: 'international',
        name: 'Dark S02E03',
        group: 'Series/Drama',
        url: xtream('series', '6001.mkv'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'Dark',
            season: 2,
            episode: 3,
            hasExplicitSeason: true,
        },
        note: 'Zero-padded, unspaced — the canonical international form.',
    },
    {
        dialect: 'international',
        name: 'The Office 1x02',
        group: 'Series/Comedy',
        url: xtream('series', '6002.mp4'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'The Office',
            season: 1,
            episode: 2,
            hasExplicitSeason: true,
        },
        note: 'Cross form with a 2-digit episode, which is what separates it from the film title "4x4".',
    },
    {
        dialect: 'international',
        name: 'Breaking Bad - Episode 5',
        group: 'Series/Drama',
        url: xtream('series', '6003.mp4'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'Breaking Bad',
            season: 1,
            episode: 5,
            hasExplicitSeason: false,
        },
        note: 'Word-first English marker. It is WEAK evidence under /movie/ but sufficient under /series/, where the path already settled the kind.',
    },
    {
        dialect: 'international',
        name: 'Tatort Staffel 2 Folge 12',
        group: 'DE | Series',
        url: xtream('series', '6004.mp4'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'Tatort',
            season: 2,
            episode: 12,
            hasExplicitSeason: true,
        },
        note: 'German season+episode words in one name.',
    },
    {
        dialect: 'international',
        name: 'Друзья 12 серия',
        group: 'RU | Series',
        url: xtream('series', '6005.mp4'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'Друзья',
            season: 1,
            episode: 12,
            hasExplicitSeason: false,
        },
        note: 'Cyrillic number-first marker. ASCII word boundaries never fire next to Cyrillic letters, which is why the rules use an explicit non-letter guard.',
    },
    {
        dialect: 'international',
        name: 'Severance S01E01 - Good News About Hell',
        group: 'Apple TV+ | Series',
        url: xtream('series', '6006.mkv'),
        kind: 'episode',
        tag: null,
        episode: {
            seriesTitle: 'Severance',
            season: 1,
            episode: 1,
            hasExplicitSeason: true,
        },
        note: 'A genuine episode title follows the marker. Everything after the marker is dropped from the SERIES title and kept separately, or the 40k-row collapse never happens.',
    },
];

/** The complete corpus, in a stable order. */
export const M3U_ENTRY_CORPUS: readonly M3uCorpusEntry[] = [
    ...LIVE_ENTRIES,
    ...RADIO_ENTRIES,
    ...MOVIE_ENTRIES,
    ...EPISODE_ENTRIES,
];

/** Entries of one kind, for suites that only care about a single rule. */
export function corpusEntriesOfKind(
    kind: M3uCorpusKind
): readonly M3uCorpusEntry[] {
    return M3U_ENTRY_CORPUS.filter((entry) => entry.kind === kind);
}

/** Entries of one dialect, for the "does this generalize" assertions. */
export function corpusEntriesOfDialect(
    dialect: M3uCorpusEntry['dialect']
): readonly M3uCorpusEntry[] {
    return M3U_ENTRY_CORPUS.filter((entry) => entry.dialect === dialect);
}
