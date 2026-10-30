import {
    boundedOfflinePeople,
    offlinePeopleAsCast,
    offlinePersonTrackKey,
} from './download-offline-detail.presentation';

describe('offline detail people presentation', () => {
    it('hands people to the shared cast row with the role as the character', () => {
        expect(
            offlinePeopleAsCast([
                {
                    name: 'Ada Actor',
                    role: 'Mara',
                    profileUrl: 'https://img/ada.jpg',
                },
                { name: 'Cora Creator', tmdbPersonId: 7 },
            ])
        ).toEqual([
            {
                name: 'Ada Actor',
                character: 'Mara',
                profileUrl: 'https://img/ada.jpg',
                tmdbPersonId: undefined,
            },
            {
                name: 'Cora Creator',
                character: undefined,
                profileUrl: null,
                tmdbPersonId: 7,
            },
        ]);
    });

    it('deduplicates people and supplies unique stable composite track keys', () => {
        const people = boundedOfflinePeople([
            { tmdbPersonId: 7, name: 'Ada Actor', role: 'Lead' },
            { tmdbPersonId: 7, name: 'Ada Actor', role: 'Duplicate' },
            { tmdbPersonId: 8, name: 'Ada Actor', role: 'Lead' },
            { name: 'Ada Actor', role: 'Lead' },
            { name: 'Casey Guest', role: 'Pilot' },
            { name: 'Casey Guest', role: 'Pilot' },
            { name: 'Casey Guest', role: 'Captain' },
        ]);

        expect(people).toEqual([
            { tmdbPersonId: 7, name: 'Ada Actor', role: 'Lead' },
            { name: 'Casey Guest', role: 'Pilot' },
            { name: 'Casey Guest', role: 'Captain' },
        ]);
        expect(new Set(people.map(offlinePersonTrackKey)).size).toBe(
            people.length
        );
    });
});
