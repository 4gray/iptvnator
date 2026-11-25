import { sourceRequestRoute } from './source-sync-request-route';

const KIDS = 'profile:11111111-1111-4111-8111-111111111111' as const;
const encoded = encodeURIComponent(KIDS);

describe('Electron sourceRequestRoute scope', () => {
    it('adds a valid scope with the cursor', () => {
        expect(
            sourceRequestRoute({
                operation: 'activity-list',
                id: 's',
                cursor: 'c',
                scope: KIDS,
            }).path
        ).toBe(`/v1/activity/sources/s/items?cursor=c&scope=${encoded}`);
        expect(
            sourceRequestRoute({
                operation: 'history-read',
                id: 's',
                scope: KIDS,
            }).path
        ).toBe(`/v1/history/sources/s?scope=${encoded}`);
        expect(
            sourceRequestRoute({
                operation: 'favorites-list',
                id: 's',
                scope: KIDS,
            }).path
        ).toBe(`/v1/favorites/sources/s/items?scope=${encoded}`);
    });

    it('rejects a scope that is not shared or a profile id', () => {
        for (const scope of ['profile:x', '../x', 'shared&scope=x', ''])
            expect(() =>
                sourceRequestRoute({
                    operation: 'favorites-list',
                    id: 's',
                    scope: scope as never,
                })
            ).toThrow('Invalid personal scope');
    });

    it('keeps a Default-profile request unchanged', () => {
        expect(
            sourceRequestRoute({
                operation: 'favorites-list',
                id: 's',
                cursor: 'c',
            }).path
        ).toBe('/v1/favorites/sources/s/items?cursor=c');
        expect(
            sourceRequestRoute({ operation: 'history-read', id: 's' }).path
        ).toBe('/v1/history/sources/s');
    });
});
