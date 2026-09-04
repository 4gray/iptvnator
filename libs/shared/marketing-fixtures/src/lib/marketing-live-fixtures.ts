/**
 * Provider-neutral fictional live TV fixtures shared by the Xtream and
 * Stalker marketing mocks, plus the generated logo artwork both serve from
 * `/assets/marketing/logo/<slug>.svg`. Everything here is invented: no real
 * broadcaster, programme, or logo is referenced, which is what makes the
 * screenshots built on top of it publishable.
 */

export type MarketingLiveCategoryKey =
    | 'newsroom'
    | 'sports'
    | 'family'
    | 'culture';

export interface MarketingLiveCategoryFixture {
    key: MarketingLiveCategoryKey;
    name: string;
}

export interface MarketingLiveChannelFixture {
    categoryKey: MarketingLiveCategoryKey;
    name: string;
    /** Cycled through the generated schedule, so the guide always has titles. */
    epgTitles: readonly string[];
}

export const MARKETING_LIVE_CATEGORIES: readonly MarketingLiveCategoryFixture[] =
    [
        { key: 'newsroom', name: 'Newsroom' },
        { key: 'sports', name: 'Sports & Motion' },
        { key: 'family', name: 'Family Channels' },
        { key: 'culture', name: 'Culture & Docs' },
    ];

export const MARKETING_LIVE_CHANNELS: readonly MarketingLiveChannelFixture[] = [
    {
        categoryKey: 'newsroom',
        name: 'Aurora News',
        epgTitles: ['Morning Briefing', 'City Desk', 'Global Window'],
    },
    {
        categoryKey: 'newsroom',
        name: 'Civic One',
        epgTitles: ['Town Hall Live', 'Policy Today', 'Open Forum'],
    },
    {
        categoryKey: 'sports',
        name: 'Fieldside Sports',
        epgTitles: ['Training Ground', 'Matchday Studio', 'Final Whistle'],
    },
    {
        categoryKey: 'sports',
        name: 'Motion Arena',
        epgTitles: ['Court Vision', 'Trackside', 'Night Highlights'],
    },
    {
        categoryKey: 'family',
        name: 'Horizon Kids',
        epgTitles: ['Rocket Workshop', 'Tiny Explorers', 'Story Lantern'],
    },
    {
        categoryKey: 'family',
        name: 'Kitchen Lab',
        epgTitles: ['Breakfast Builders', 'Family Table', 'Sweet Science'],
    },
    {
        categoryKey: 'culture',
        name: 'Atlas Docs',
        epgTitles: ['Ocean Notes', 'Museum Hour', 'Wide Angle'],
    },
    {
        categoryKey: 'culture',
        name: 'Night Music',
        epgTitles: ['Studio Session', 'Late Set', 'Ambient City'],
    },
];

export const MARKETING_LOGO_ASSET_PATH = '/assets/marketing/logo';

/** URL-safe slug shared by asset URLs and the renderer that answers them. */
export function marketingSlug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Inverse of `marketingSlug` for rendering initials back out of a URL. */
export function marketingTitleFromSlug(slug: string): string {
    return slug
        .replace(/\.svg$/i, '')
        .split('-')
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ');
}

export function marketingHash(value: string): number {
    return value.split('').reduce((acc, char) => {
        return (acc * 31 + char.charCodeAt(0)) >>> 0;
    }, 0);
}

export function marketingPalette(seed: string): [string, string, string] {
    const palettes: Array<[string, string, string]> = [
        ['#0b1026', '#1b6b77', '#f2a65a'],
        ['#15111f', '#6b3fa0', '#20c7b5'],
        ['#071b2c', '#2457a6', '#f05d5e'],
        ['#1b1b24', '#8d4f2a', '#e9c46a'],
        ['#10251d', '#2a9d8f', '#e76f51'],
        ['#18151f', '#b23a48', '#f4a261'],
    ];
    return palettes[marketingHash(seed) % palettes.length];
}

export function marketingSvgDocument(
    width: number,
    height: number,
    body: string
): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">${body}</svg>`;
}

export function escapeMarketingSvg(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** `WIDTHxHEIGHT` query value; falls back to a square 256 px logo. */
export function parseMarketingLogoSize(size: string | undefined): {
    width: number;
    height: number;
} {
    const match = size?.match(/^(\d+)x(\d+)$/);
    if (!match) {
        return { width: 256, height: 256 };
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Channel logo: gradient tile with the channel initials. Identical output for
 * both mocks so a screenshot looks the same whichever portal type it shows.
 */
export function renderMarketingLogoSvg(
    slug: string,
    size: string | undefined
): string {
    const { width, height } = parseMarketingLogoSize(size);
    const title = marketingTitleFromSlug(slug);
    const palette = marketingPalette(`logo:${slug}`);
    const initials = title
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('');

    return marketingSvgDocument(
        width,
        height,
        `
        <defs>
            <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stop-color="${palette[0]}" />
                <stop offset="100%" stop-color="${palette[1]}" />
            </linearGradient>
        </defs>
        <rect width="100%" height="100%" rx="${width * 0.22}" fill="url(#bg)" />
        <circle cx="${width * 0.72}" cy="${height * 0.25}" r="${width * 0.2}" fill="${palette[2]}" opacity="0.35" />
        <path d="M ${width * 0.16} ${height * 0.72} C ${width * 0.35} ${height * 0.48}, ${width * 0.58} ${height * 0.92}, ${width * 0.84} ${height * 0.58}" fill="none" stroke="#fff" stroke-width="${Math.max(8, width * 0.05)}" stroke-linecap="round" opacity="0.42" />
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${width * 0.3}" font-weight="800" fill="#fff">${escapeMarketingSvg(initials)}</text>
        `
    );
}
