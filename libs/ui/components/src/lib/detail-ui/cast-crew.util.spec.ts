import {
    buildCastCrewEntries,
    castMembersFromNames,
    personInitials,
    splitPeopleNames,
} from './cast-crew.util';

describe('splitPeopleNames', () => {
    it('splits on commas and semicolons and drops duplicates', () => {
        expect(splitPeopleNames('Mara Venn, Elias Shore; mara venn, ')).toEqual([
            'Mara Venn',
            'Elias Shore',
        ]);
        expect(splitPeopleNames(undefined)).toEqual([]);
    });
});

describe('buildCastCrewEntries', () => {
    it('lists the director first and dedupes a director who also acts', () => {
        const entries = buildCastCrewEntries(
            [
                { name: 'Russell Crowe', character: 'Henry Murray', profileUrl: 'a.jpg', tmdbPersonId: 1 },
                { name: 'Janus Metz', profileUrl: null },
                { name: 'Mark Camacho', profileUrl: null },
            ],
            [{ name: 'Janus Metz', profileUrl: null, tmdbPersonId: 7 }],
            'Director'
        );
        expect(entries.map((entry) => [entry.name, entry.role])).toEqual([
            ['Janus Metz', 'Director'],
            ['Russell Crowe', 'Henry Murray'],
            ['Mark Camacho', null],
        ]);
        expect(entries[0].key).toBe('p7');
        expect(entries[2].initials).toBe('MC');
    });

    it('wraps provider names without photos', () => {
        expect(castMembersFromNames(['A B'])).toEqual([
            { name: 'A B', profileUrl: null },
        ]);
    });
});

describe('personInitials', () => {
    it('takes the first and last initials', () => {
        expect(personInitials('Aleksandr Samoylenko Jr.')).toBe('AJ');
        expect(personInitials('Cher')).toBe('C');
        expect(personInitials('')).toBe('');
    });
});
