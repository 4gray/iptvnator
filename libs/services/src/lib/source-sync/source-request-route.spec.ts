import { sourceRequestRoute } from './source-request-route';

const KIDS = 'profile:11111111-1111-4111-8111-111111111111' as const;
const encoded = encodeURIComponent(KIDS);

describe('sourceRequestRoute scope', () => {
    it.each([
        ['favorites-list', '/v1/favorites/sources/s/items'],
        ['activity-list', '/v1/activity/sources/s/items'],
    ] as const)('adds scope and cursor to %s', (operation, path) => {
        expect(
            sourceRequestRoute({ operation, id: 's', scope: KIDS }).path
        ).toBe(`${path}?scope=${encoded}`);
        expect(
            sourceRequestRoute({ operation, id: 's', cursor: 'c', scope: KIDS })
                .path
        ).toBe(`${path}?cursor=c&scope=${encoded}`);
    });

    it('adds scope to a history read', () => {
        expect(
            sourceRequestRoute({
                operation: 'history-read',
                id: 's',
                scope: KIDS,
            }).path
        ).toBe(`/v1/history/sources/s?scope=${encoded}`);
    });

    it('leaves a Default-profile request untouched', () => {
        expect(
            sourceRequestRoute({ operation: 'history-read', id: 's' }).path
        ).toBe('/v1/history/sources/s');
        expect(
            sourceRequestRoute({
                operation: 'favorites-list',
                id: 's',
                cursor: 'c',
            }).path
        ).toBe('/v1/favorites/sources/s/items?cursor=c');
        expect(
            sourceRequestRoute({ operation: 'activity-list', id: 's' }).path
        ).toBe('/v1/activity/sources/s/items');
    });
});
