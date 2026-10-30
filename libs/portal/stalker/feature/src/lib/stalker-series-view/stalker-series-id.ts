/**
 * The numeric series id of a Stalker item id: the part before the first `:`
 * when the id carries a suffix. An empty or non-numeric id resolves to 0,
 * which callers treat as "no series".
 */
export function toStalkerSeriesId(id: string | number): number {
    const raw = String(id ?? '').trim();
    if (!raw) return 0;
    const primary = raw.includes(':') ? raw.split(':')[0] : raw;
    const parsed = Number(primary);
    return Number.isFinite(parsed) ? parsed : 0;
}
