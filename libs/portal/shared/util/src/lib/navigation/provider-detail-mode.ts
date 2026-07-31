export const PROVIDER_ONLY_DETAIL_PRESENTATION = 'provider-only' as const;

export function isProviderOnlyDetailState(state: unknown): boolean {
    return (
        typeof state === 'object' &&
        state !== null &&
        (state as { detailPresentation?: unknown }).detailPresentation ===
            PROVIDER_ONLY_DETAIL_PRESENTATION
    );
}
