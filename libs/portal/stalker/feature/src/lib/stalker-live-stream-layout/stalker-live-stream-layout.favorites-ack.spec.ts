import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';
describe('durable live favorites', () => {
    it('changes live membership only after the local write is acknowledged and retains kind on removal', () => {
        const item = {
            id: '90042',
            name: 'Synthetic live favorite',
            cmd: 'synthetic-command',
        } as Parameters<StalkerLiveStreamLayoutComponent['toggleFavorite']>[0];
        const target = Object.create(
            StalkerLiveStreamLayoutComponent.prototype
        );
        const add = jest.fn();
        const remove = jest.fn();
        Object.assign(target, {
            favorites: new Map(),
            stalkerStore: { addToFavorites: add, removeFromFavorites: remove },
            isRadioMode: () => true,
            toPlayableChannel: () => item,
            cdr: { markForCheck: jest.fn() },
        });
        target.toggleFavorite(item);
        expect(target.favorites.has('90042')).toBe(false);
        add.mock.calls[0][1]();
        expect(target.favorites.has('90042')).toBe(true);
        target.toggleFavorite(item);
        expect(target.favorites.has('90042')).toBe(true);
        expect(remove.mock.calls[0][2]).toEqual(
            expect.objectContaining({ id: '90042', category_id: 'radio' })
        );
        remove.mock.calls[0][1]();
        expect(target.favorites.has('90042')).toBe(false);
    });
});
