import { Channel } from '@iptvnator/shared/interfaces';

function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.keys(value as Record<string, unknown>)
            .sort()
            .map(
                (key) =>
                    `${JSON.stringify(key)}:${canonical(
                        (value as Record<string, unknown>)[key]
                    )}`
            );
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

/**
 * Whether two playlist entries are the same entry, field for field. The
 * store spreads the selected channel and resets `epgParams`, so identity is
 * lost and only the data can tell copies apart: two rows may share id, url,
 * group and name yet differ in playback headers or logo, and each is its own
 * guide row. `epgParams` is excluded because the reducer rewrites it.
 */
export function isSameChannelEntry(a: Channel, b: Channel): boolean {
    const { epgParams: _a, ...restA } = a;
    const { epgParams: _b, ...restB } = b;
    return canonical(restA) === canonical(restB);
}
