export interface ScenarioConfig {
    name: string;
    description: string;
    seed: number;
    categoryCount: {
        itv: number;
        radio: number;
        vod: number;
        series: number;
    };
    itemsPerCategory: number;
    seasonsPerSeries: number;
    episodesPerSeason: number;
    /** Fraction of VOD items that have is_series=1 (Ministra mode) */
    isSeriesFraction: number;
    /** Fraction of VOD items that have embedded series[] array */
    embeddedSeriesFraction: number;
    /**
     * Whether the portal implements the ITV `get_all_channels` action.
     * Defaults to true; set false to force clients onto paginated
     * `get_ordered_list` crawling (legacy portals).
     */
    supportsGetAllChannels?: boolean;
    /** Replace generated VOD with the shared screenshot-safe poster catalog. */
    marketingFixture?: true;
    /** Answer `get_profile` with `status: 2` until `auth_second_step=1`. */
    requiresLogin?: true;
    /**
     * `create_link` returns this server's own `/stream/gated/video.mp4`,
     * which answers 403 unless the request carries the portal mac cookie AND
     * the MAC's Bearer token — proves a player's media requests really carry
     * the portal credentials (the "only VLC works" cluster).
     */
    gatedStream?: true;
}

/**
 * Predefined scenarios keyed by MAC address (lowercase, colon-separated).
 * Any unknown MAC uses its bytes as the seed for deterministic-but-unique data.
 */
export const SCENARIOS: Record<string, ScenarioConfig> = {
    '00:1a:79:00:00:01': {
        name: 'default',
        description: 'Balanced portal — 8 categories, 40 items each',
        seed: 1001,
        categoryCount: { itv: 8, radio: 8, vod: 8, series: 8 },
        itemsPerCategory: 40,
        seasonsPerSeries: 3,
        episodesPerSeason: 8,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
    },
    '00:1a:79:ff:ff:ff': {
        name: 'large',
        description: 'Large catalog — 20 categories, 200 items each',
        seed: 9999,
        categoryCount: { itv: 20, radio: 20, vod: 20, series: 20 },
        itemsPerCategory: 200,
        seasonsPerSeries: 5,
        episodesPerSeason: 12,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
    },
    '00:1a:79:00:00:02': {
        name: 'series-heavy',
        description: 'Series-heavy portal — many series with deep seasons',
        seed: 2002,
        categoryCount: { itv: 3, radio: 3, vod: 5, series: 15 },
        itemsPerCategory: 30,
        seasonsPerSeries: 6,
        episodesPerSeason: 10,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
    },
    '00:1a:79:00:00:03': {
        name: 'minimal',
        description: 'Minimal portal — 2 categories, 5 items (edge case testing)',
        seed: 3003,
        categoryCount: { itv: 2, radio: 2, vod: 2, series: 2 },
        itemsPerCategory: 5,
        seasonsPerSeries: 1,
        episodesPerSeason: 3,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
    },
    '00:1a:79:00:00:04': {
        name: 'is-series',
        description: 'VOD with is_series=1 flag (Ministra plugin flow testing)',
        seed: 4004,
        categoryCount: { itv: 4, radio: 4, vod: 6, series: 4 },
        itemsPerCategory: 20,
        seasonsPerSeries: 3,
        episodesPerSeason: 6,
        isSeriesFraction: 0.6, // 60% of VOD items are is_series=1
        embeddedSeriesFraction: 0,
    },
    '00:1a:79:00:00:05': {
        name: 'embedded-series',
        description: 'VOD with embedded series[] arrays',
        seed: 5005,
        categoryCount: { itv: 4, radio: 4, vod: 6, series: 4 },
        itemsPerCategory: 20,
        seasonsPerSeries: 2,
        episodesPerSeason: 5,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0.5, // 50% of VOD items have embedded series[]
    },
    '00:1a:79:00:00:06': {
        name: 'legacy-pagination',
        description:
            'Portal without get_all_channels — clients must crawl get_ordered_list pages',
        seed: 6006,
        categoryCount: { itv: 6, radio: 4, vod: 4, series: 4 },
        itemsPerCategory: 40,
        seasonsPerSeries: 2,
        episodesPerSeason: 5,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
        supportsGetAllChannels: false,
    },
    '00:1a:79:00:00:08': {
        name: 'login-required',
        description:
            'Portal answering get_profile with status 2 until do_auth completes',
        seed: 8008,
        categoryCount: { itv: 4, radio: 4, vod: 4, series: 4 },
        itemsPerCategory: 10,
        seasonsPerSeries: 2,
        episodesPerSeason: 4,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
        requiresLogin: true,
    },
    '00:1a:79:00:00:07': {
        name: 'marketing-demo',
        description: 'Screenshot-safe portal with 35 original poster movies',
        seed: 7007,
        categoryCount: { itv: 4, radio: 4, vod: 4, series: 4 },
        itemsPerCategory: 6,
        seasonsPerSeries: 2,
        episodesPerSeason: 5,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
        marketingFixture: true,
    },
    '00:1a:79:00:00:09': {
        name: 'gated-stream',
        description:
            'Streams gated on portal credentials — create_link returns a ' +
            'local URL that 403s without the mac cookie + Bearer token',
        seed: 9009,
        categoryCount: { itv: 2, radio: 1, vod: 1, series: 1 },
        itemsPerCategory: 5,
        seasonsPerSeries: 1,
        episodesPerSeason: 3,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
        gatedStream: true,
    },
};

/**
 * Convert a MAC address string to a numeric seed for unknown MACs.
 * e.g. "AA:BB:CC:DD:EE:FF" -> sum of byte values
 */
export function macToSeed(mac: string): number {
    return mac
        .toLowerCase()
        .split(':')
        .reduce((acc, byte) => acc + parseInt(byte, 16), 0);
}

/** Return the scenario config for a given MAC, falling back to a seeded default. */
export function getScenario(mac: string): ScenarioConfig {
    const normalizedMac = mac.toLowerCase();
    if (SCENARIOS[normalizedMac]) {
        return SCENARIOS[normalizedMac];
    }
    // Unknown MAC: use MAC bytes as seed, default shape
    return {
        name: 'auto',
        description: `Auto-generated from MAC ${mac}`,
        seed: macToSeed(mac),
        categoryCount: { itv: 6, radio: 6, vod: 6, series: 6 },
        itemsPerCategory: 30,
        seasonsPerSeries: 3,
        episodesPerSeason: 8,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
    };
}
