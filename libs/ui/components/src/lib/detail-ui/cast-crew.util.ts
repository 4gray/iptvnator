import type { TmdbEnrichedCastMember } from '@iptvnator/shared/interfaces';

/** One avatar of the "Cast & crew" row. */
export interface CastCrewEntry {
    readonly key: string;
    readonly name: string;
    /** Character for actors, a translated "Director" for crew, else null. */
    readonly role: string | null;
    readonly profileUrl: string | null;
    readonly initials: string;
    readonly member: TmdbEnrichedCastMember;
}

/**
 * "Mara Venn, Elias Shore; Tomas Bell" → names. Providers join the cast with
 * commas (Xtream) or semicolons (some Stalker portals); either way a name
 * never contains the separator.
 */
export function splitPeopleNames(value: string | null | undefined): string[] {
    if (!value) {
        return [];
    }
    const seen = new Set<string>();
    const names: string[] = [];
    for (const part of value.split(/[,;]/)) {
        const name = part.trim();
        const key = normalizePersonName(name);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        names.push(name);
    }
    return names;
}

/** Plain names (no TMDB data) as cast members without photo or character. */
export function castMembersFromNames(
    names: readonly string[]
): TmdbEnrichedCastMember[] {
    return names.map((name) => ({ name, profileUrl: null }));
}

/**
 * Director first, then the cast, one entry per person: a director who also
 * acts keeps the single "Director" avatar.
 */
export function buildCastCrewEntries(
    cast: readonly TmdbEnrichedCastMember[],
    directors: readonly TmdbEnrichedCastMember[],
    directorRole: string
): CastCrewEntry[] {
    const seen = new Set<string>();
    const entries: CastCrewEntry[] = [];
    const push = (member: TmdbEnrichedCastMember, role: string | null) => {
        const key = normalizePersonName(member.name);
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        entries.push({
            key: member.tmdbPersonId ? `p${member.tmdbPersonId}` : `n:${key}`,
            name: member.name.trim(),
            role,
            profileUrl: member.profileUrl ?? null,
            initials: personInitials(member.name),
            member,
        });
    };
    directors.forEach((member) => push(member, directorRole));
    cast.forEach((member) => push(member, member.character?.trim() || null));
    return entries;
}

export function personInitials(name: string): string {
    const parts = name
        .trim()
        .split(/\s+/)
        .filter((part) => part.length > 0);
    if (parts.length === 0) {
        return '';
    }
    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
    return `${first}${last}`.toUpperCase();
}

function normalizePersonName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
