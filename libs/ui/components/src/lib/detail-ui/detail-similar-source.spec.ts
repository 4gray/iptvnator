import { mergeSimilarRailItems } from './detail-similar-source';

describe(mergeSimilarRailItems.name, () => {
    it('prefers the local source for the same title and year and keeps other releases', () => {
        const local = {
            key: 'local',
            title: 'Fictional Harbor',
            year: 2024,
            posterUrl: null,
        };
        const duplicate = { ...local, key: 'other', title: 'fictional harbor' };
        const remake = { ...duplicate, key: 'remake', year: 1982 };

        expect(mergeSimilarRailItems([local], [duplicate, remake])).toEqual([
            local,
            remake,
        ]);
        expect(mergeSimilarRailItems([], [duplicate])).toEqual([duplicate]);
    });
});
