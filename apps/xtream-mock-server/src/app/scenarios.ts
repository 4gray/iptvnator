export interface ScenarioConfig {
    name: string;
    description: string;
    seed: number;
    categoryCount: { live: number; vod: number; series: number };
    itemsPerCategory: number;
    seasonsPerSeries: number;
    episodesPerSeason: number;
    /** 'Active' | 'Disabled' — mirrors real Xtream user status values.
     *  Expired accounts still have status 'Active' but exp_date is in the past. */
    accountStatus: 'Active' | 'Disabled';
    /** ISO date string for subscription expiry */
    expiryDate: string;
}

/**
 * Predefined scenarios keyed by "username:password".
 * Auth is username+password for Xtream (not MAC address like Stalker).
 * Unknown credential pairs use a hash of "username:password" as seed.
 */
export const SCENARIOS: Record<string, ScenarioConfig> = {
    'user1:pass1': {
        name: 'default',
        description: 'Balanced portal — 8 categories, 40 items each',
        seed: 1001,
        categoryCount: { live: 8, vod: 8, series: 8 },
        itemsPerCategory: 40,
        seasonsPerSeries: 3,
        episodesPerSeason: 8,
        accountStatus: 'Active',
        expiryDate: '2099-12-31',
    },
    'large:large': {
        name: 'large',
        description: 'Large catalog — 20 categories, 200 items each',
        seed: 9999,
        categoryCount: { live: 20, vod: 20, series: 20 },
        itemsPerCategory: 200,
        seasonsPerSeries: 5,
        episodesPerSeason: 12,
        accountStatus: 'Active',
        expiryDate: '2099-12-31',
    },
    'series:series': {
        name: 'series-heavy',
        description: 'Series-heavy — 15 series categories, 6 seasons × 10 episodes',
        seed: 2002,
        categoryCount: { live: 3, vod: 4, series: 15 },
        itemsPerCategory: 30,
        seasonsPerSeries: 6,
        episodesPerSeason: 10,
        accountStatus: 'Active',
        expiryDate: '2099-12-31',
    },
    'minimal:minimal': {
        name: 'minimal',
        description: 'Minimal — 2 categories, 5 items (edge case testing)',
        seed: 3003,
        categoryCount: { live: 2, vod: 2, series: 2 },
        itemsPerCategory: 5,
        seasonsPerSeries: 1,
        episodesPerSeason: 3,
        accountStatus: 'Active',
        expiryDate: '2099-12-31',
    },
    'expired:expired': {
        name: 'expired',
        description: 'Expired account — tests subscription expiry UI flow',
        seed: 4004,
        categoryCount: { live: 4, vod: 4, series: 4 },
        itemsPerCategory: 10,
        seasonsPerSeries: 2,
        episodesPerSeason: 5,
        accountStatus: 'Active', // Active but exp_date is in the past → service treats as expired
        expiryDate: '2020-01-01',
    },
    'inactive:inactive': {
        name: 'inactive',
        description: 'Disabled account — tests account disabled UI flow',
        seed: 5005,
        categoryCount: { live: 4, vod: 4, series: 4 },
        itemsPerCategory: 10,
        seasonsPerSeries: 2,
        episodesPerSeason: 5,
        accountStatus: 'Disabled',
        expiryDate: '2020-01-01',
    },
};

/** Convert credential pair to a numeric seed for unknown credentials. */
export function credentialsToSeed(username: string, password: string): number {
    const str = `${username}:${password}`;
    return str.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0) >>> 0;
}

/** Return the scenario config for a given username+password pair. */
export function getScenario(username: string, password: string): ScenarioConfig {
    const key = `${username}:${password}`;
    if (SCENARIOS[key]) return SCENARIOS[key];
    return {
        name: 'auto',
        description: `Auto-generated for ${username}`,
        seed: credentialsToSeed(username, password),
        categoryCount: { live: 6, vod: 6, series: 6 },
        itemsPerCategory: 30,
        seasonsPerSeries: 3,
        episodesPerSeason: 8,
        accountStatus: 'Active',
        expiryDate: '2099-12-31',
    };
}
