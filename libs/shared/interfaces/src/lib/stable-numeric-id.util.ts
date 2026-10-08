/**
 * A deterministic positive integer derived from a string.
 *
 * ## Why this exists
 *
 * The shared season/episode UI the portals use keys everything on numeric
 * ids — `seriesId` is a `number`, and playback positions are looked up by
 * `Number(episode.id)`. M3U has no numeric ids of any kind, so a catalog
 * built from a playlist has to mint them, deterministically, from something
 * stable.
 *
 * ## Why 48 bits
 *
 * A collision does not merely mis-render: these ids key persisted playback
 * positions, so two colliding episodes share one "watched" row and the
 * viewer sees the wrong episode marked as seen. Over ~42,000 episode keys a
 * 31-bit hash collides with probability ≈0.4% — high enough to happen to
 * real users. 48 bits puts it near 2e-7 while staying comfortably inside
 * both `Number.MAX_SAFE_INTEGER` and SQLite's signed 64-bit INTEGER.
 *
 * Callers that own the full key set should still run a deterministic probe
 * for the residual case; this function only guarantees determinism, not
 * uniqueness.
 *
 * Existing 31-bit ids elsewhere in the app are NOT migrated onto this:
 * theirs are already persisted in `playback_positions`, and rehashing them
 * would silently discard watch history.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HALF_MASK = 0xffffff;
const HALF_SHIFT = 0x1000000;

function fnv1a(value: string, seed: number): number {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
}

export function hashM3uId(value: string): number {
    return createM3uIdHasher('')(value);
}

/**
 * `hashM3uId(prefix + suffix)` for many suffixes of one prefix.
 *
 * FNV-1a consumes its input left to right, so the state after the prefix
 * can be kept and continued. A series mints one id per episode from
 * `series key + coordinate`; hashing the long key once instead of once per
 * episode is most of the cost of building a 40k-episode catalog.
 */
export function createM3uIdHasher(prefix: string): (suffix: string) => number {
    // Two independently seeded passes rather than one 32-bit hash widened:
    // widening cannot add entropy, and the collision rate is what the extra
    // bits are for.
    const highState = fnv1a(prefix, FNV_OFFSET);
    const lowState = fnv1a(prefix, FNV_PRIME);

    return (suffix) => {
        const high = fnv1a(suffix, highState) & HALF_MASK;
        const low = fnv1a(suffix, lowState) & HALF_MASK;
        const id = high * HALF_SHIFT + low;

        // Zero is reserved: callers treat a falsy id as "no id".
        return id === 0 ? 1 : id;
    };
}
