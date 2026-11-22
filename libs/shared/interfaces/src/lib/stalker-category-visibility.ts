const sections = ['itv', 'radio', 'vod', 'series'] as const;
type Section = (typeof sections)[number];

export type HiddenStalkerCategories = Partial<Record<Section, string[]>>;

export type StalkerCategoryVisibilityChanges = Partial<
    Record<Section, { hide?: readonly string[]; show?: readonly string[] }>
>;

function isProviderCategoryId(id: unknown): id is string {
    return typeof id === 'string' && id.trim() !== '' && id.trim() !== '*';
}

export function isHiddenStalkerCategories(
    value: unknown
): value is HiddenStalkerCategories {
    return (
        value != null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.entries(value).every(
            ([section, ids]) =>
                sections.some((key) => key === section) &&
                Array.isArray(ids) &&
                ids.every(isProviderCategoryId)
        )
    );
}

/** Apply only the edited IDs; keep unavailable genres and concurrent changes. */
export function applyStalkerCategoryVisibility(
    current: HiddenStalkerCategories | undefined,
    changes: StalkerCategoryVisibilityChanges
): HiddenStalkerCategories {
    const result = { ...current };
    for (const section of sections) {
        const change = changes[section];
        if (!change) continue;
        const hidden = new Set(result[section]);
        for (const id of change.hide ?? []) {
            if (isProviderCategoryId(id)) hidden.add(id);
        }
        for (const id of change.show ?? []) hidden.delete(id);
        if (hidden.size) result[section] = [...hidden];
        else delete result[section];
    }
    return result;
}
