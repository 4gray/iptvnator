export interface ScenarioConfig {
    name: string;
    description: string;
    seed: number;
    categoryCount: {
        itv: number;
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
        categoryCount: { itv: 8, vod: 8, series: 8 },
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
        categoryCount: { itv: 20, vod: 20, series: 20 },
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
        categoryCount: { itv: 3, vod: 5, series: 15 },
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
        categoryCount: { itv: 2, vod: 2, series: 2 },
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
        categoryCount: { itv: 4, vod: 6, series: 4 },
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
        categoryCount: { itv: 4, vod: 6, series: 4 },
        itemsPerCategory: 20,
        seasonsPerSeries: 2,
        episodesPerSeason: 5,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0.5, // 50% of VOD items have embedded series[]
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
        categoryCount: { itv: 6, vod: 6, series: 6 },
        itemsPerCategory: 30,
        seasonsPerSeries: 3,
        episodesPerSeason: 8,
        isSeriesFraction: 0,
        embeddedSeriesFraction: 0,
    };
}
