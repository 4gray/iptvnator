import {
    PROVIDER_ONLY_DETAIL_PRESENTATION,
    isProviderOnlyDetailState,
} from './provider-detail-mode';

describe('provider detail presentation state', () => {
    it('recognizes only the explicit provider-only marker', () => {
        expect(
            isProviderOnlyDetailState({
                detailPresentation: PROVIDER_ONLY_DETAIL_PRESENTATION,
            })
        ).toBe(true);

        expect(isProviderOnlyDetailState(null)).toBe(false);
        expect(isProviderOnlyDetailState({})).toBe(false);
        expect(
            isProviderOnlyDetailState({ detailPresentation: 'offline' })
        ).toBe(false);
    });
});
