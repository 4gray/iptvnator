import type { Media } from './index';

export function detailPeople(item: Media) {
    const metadata = item.metadata;
    if (!metadata) return [];
    const seen = new Set<string>();
    const ids = new Set<number>();
    return [
        ...metadata.authors.map((person) => ({
            ...person,
            role: metadata.authorRole === 'Creators' ? 'Creator' : 'Director',
        })),
        ...metadata.cast.map((person) => ({
            ...person,
            role: person.character?.trim() || 'Actor',
        })),
    ].filter((person) => {
        const name = person.name.trim().toLowerCase().replace(/\s+/g, ' ');
        if (
            !name ||
            seen.has(name) ||
            (person.tmdbPersonId && ids.has(person.tmdbPersonId))
        )
            return false;
        seen.add(name);
        if (person.tmdbPersonId) ids.add(person.tmdbPersonId);
        return true;
    });
}

function values(input: unknown) {
    const parts = Array.isArray(input)
        ? input
        : typeof input === 'string'
          ? input.replace(/\bN\/A\b/gi, '').split(/[,;|/]/)
          : [];
    const seen = new Set<string>();
    return parts
        .filter((part): part is string => {
            if (typeof part !== 'string') return false;
            const key = part.trim().toLowerCase();
            if (
                !key ||
                /^(n\/a|unknown|none|null|undefined|-)$/.test(key) ||
                seen.has(key)
            )
                return false;
            seen.add(key);
            return true;
        })
        .map((part) => part.trim());
}

export function detailChips(item: Media) {
    const raw = item.raw;
    const payload = raw.details as
        { info?: Record<string, unknown> } | undefined;
    const info = payload?.info ?? raw;
    const metadata = item.metadata;
    const genres = values(metadata?.genres);
    const countries = values(metadata?.countries);
    const chips: { label: string; value: string }[] = [];
    const add = (label: string, value: string) => chips.push({ label, value });
    const year = [
        item.year,
        metadata?.year,
        info.year,
        info.releasedate,
        info.releaseDate,
    ]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.match(/\b(?:19|20)\d{2}\b/)?.[0])
        .find(Boolean);
    if (year) add('Year', year);
    for (const genre of genres.length
        ? genres
        : values(info.genre ?? raw.genre))
        add('Genre', genre);
    for (const country of countries.length
        ? countries
        : values(info.country ?? raw.country))
        add('Country', country);
    const category = item.categoryName?.trim();
    if (category) add('Playlist category', `Category · ${category}`);
    const duration = metadata?.durationMinutes;
    if (
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration > 0
    )
        add(
            'Duration',
            `${Math.round(duration)} min${item.kind === 'series' ? ' / episode' : ''}`
        );
    const rating = metadata?.rating;
    if (
        typeof rating === 'number' &&
        Number.isFinite(rating) &&
        rating > 0 &&
        rating <= 10
    )
        add('TMDB rating', `TMDB ${rating.toFixed(1)}`);
    return chips;
}
