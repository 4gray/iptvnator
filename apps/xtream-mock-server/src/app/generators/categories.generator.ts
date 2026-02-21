import { faker } from '@faker-js/faker';

export interface RawCategory {
    category_id: string;
    category_name: string;
    parent_id: number;
}

const LIVE_CATEGORY_NAMES = [
    'News', 'Sports', 'Movies', 'Entertainment', 'Kids',
    'Documentary', 'Music', 'Comedy', 'Drama', 'Reality TV',
    'Lifestyle', 'Travel', 'Food', 'Tech', 'Science',
    'History', 'Nature', 'Animation', 'Gaming', 'Shopping',
];

const VOD_CATEGORY_NAMES = [
    'Action', 'Comedy', 'Drama', 'Horror', 'Thriller',
    'Romance', 'Sci-Fi', 'Fantasy', 'Animation', 'Documentary',
    'Biography', 'Crime', 'Mystery', 'Adventure', 'Family',
    'War', 'Western', 'Musical', 'Sport', 'History',
];

const SERIES_CATEGORY_NAMES = [
    'Drama Series', 'Comedy Series', 'Crime Series', 'Sci-Fi Series',
    'Reality Shows', 'Anime', 'Soap Opera', 'Mini Series',
    'Documentary Series', 'Kids Shows', 'Action Series', 'Fantasy Series',
    'Medical', 'Legal', 'Political', 'Romance Series', 'Historical',
    'Thriller Series', 'Horror Series', 'Western Series',
];

function nameList(type: 'live' | 'vod' | 'series'): string[] {
    if (type === 'live') return LIVE_CATEGORY_NAMES;
    if (type === 'vod') return VOD_CATEGORY_NAMES;
    return SERIES_CATEGORY_NAMES;
}

/** Base ID offsets per content type so IDs never collide. */
const BASE_ID: Record<'live' | 'vod' | 'series', number> = {
    live: 100,
    vod: 200,
    series: 300,
};

export function generateCategories(
    type: 'live' | 'vod' | 'series',
    count: number
): RawCategory[] {
    const names = nameList(type);
    return Array.from({ length: count }, (_, i) => ({
        category_id: String(BASE_ID[type] + i + 1),
        category_name: names[i % names.length],
        parent_id: 0,
    }));
}

/** Stable category ID base for use in item generators. */
export { BASE_ID as CATEGORY_ID_BASE };

/** Deterministic icon URL for a category */
export function categoryIcon(type: string, id: string): string {
    return `https://picsum.photos/seed/cat-${type}-${id}/64/64`;
}

// Re-export faker so generators share the same seeded instance.
export { faker };
