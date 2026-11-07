/**
 * The role an aggregate member is actually known for. A returning actor
 * accumulates one entry per character, so a single-episode cameo sits in
 * `roles[]` next to the lead they played for ten seasons — pick by episode
 * count rather than by array position. Unnamed roles are skipped: TMDB
 * uses them for uncredited appearances, and they would otherwise beat a
 * real character on episode count alone.
 *
 * Exported because the cache trim keeps exactly this role and discards
 * the rest — sharing the choice is what stops a cached payload from
 * displaying a different character than the payload it was written from.
 */
export function pickAggregateRole<
    T extends { character?: string; episode_count?: number },
>(member: { roles?: T[] }): T | undefined {
    const named = (member.roles ?? []).filter((role) => role.character?.trim());
    if (named.length === 0) {
        return undefined;
    }
    return named.reduce((best, role) =>
        (role.episode_count ?? 0) > (best.episode_count ?? 0) ? role : best
    );
}
