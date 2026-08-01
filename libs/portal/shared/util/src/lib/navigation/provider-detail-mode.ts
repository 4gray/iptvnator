export const PROVIDER_ONLY_DETAIL_PRESENTATION = 'provider-only' as const;
export const PROVIDER_ONLY_DETAIL_PRESENTATION_STATE_KEY =
    'detailPresentation' as const;

export function isProviderOnlyDetailState(state: unknown): boolean {
    return (
        typeof state === 'object' &&
        state !== null &&
        (state as Record<string, unknown>)[
            PROVIDER_ONLY_DETAIL_PRESENTATION_STATE_KEY
        ] === PROVIDER_ONLY_DETAIL_PRESENTATION
    );
}
