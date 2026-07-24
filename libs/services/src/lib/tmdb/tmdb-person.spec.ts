import { mapPersonFilmography, mapPersonProfile } from './tmdb-person';
import { TmdbPersonDetails } from './tmdb.types';

const person: TmdbPersonDetails = {
    id: 287,
    name: 'Brad Pitt',
    biography: 'Bio text',
    birthday: '1963-12-18',
    place_of_birth: 'Shawnee, Oklahoma, USA',
    profile_path: '/pitt.jpg',
    combined_credits: {
        cast: [
            {
                id: 550,
                media_type: 'movie',
                title: 'Fight Club',
                release_date: '1999-10-15',
                poster_path: '/fc.jpg',
                character: 'Tyler Durden',
            },
            {
                id: 550,
                media_type: 'movie',
                title: 'Fight Club',
                release_date: '1999-10-15',
            },
            {
                id: 1104,
                media_type: 'tv',
                name: 'Friends',
                first_air_date: '1994-09-22',
                character: 'Will Colbert',
            },
            { id: 999, media_type: 'movie', title: 'Undated Movie' },
            { id: 42, title: 'No media type' },
            { id: 43, media_type: 'movie', title: '   ' },
        ],
        crew: [
            {
                id: 16869,
                media_type: 'movie',
                title: 'Legends of the Fall',
                release_date: '1994-12-16',
                job: 'Producer',
            },
            {
                id: 1422,
                media_type: 'movie',
                title: 'The Departed',
                release_date: '2006-10-05',
                job: 'Director',
            },
            {
                // Directed a title he also starred in — acting credit wins
                id: 550,
                media_type: 'movie',
                title: 'Fight Club',
                release_date: '1999-10-15',
                job: 'Director',
            },
        ],
    },
};

describe('mapPersonProfile', () => {
    it('maps the person with a full profile photo URL', () => {
        expect(mapPersonProfile(person)).toEqual({
            tmdbId: 287,
            name: 'Brad Pitt',
            biography: 'Bio text',
            birthday: '1963-12-18',
            deathday: null,
            placeOfBirth: 'Shawnee, Oklahoma, USA',
            photoUrl: 'https://image.tmdb.org/t/p/w185/pitt.jpg',
        });
    });
});

describe('mapPersonFilmography', () => {
    it('deduplicates, drops unusable credits and sorts newest first', () => {
        const credits = mapPersonFilmography(person);

        expect(credits.map((credit) => credit.tmdbId)).toEqual([
            1422, 550, 1104, 999,
        ]);
        expect(credits[1]).toEqual({
            tmdbId: 550,
            mediaType: 'movie',
            title: 'Fight Club',
            year: 1999,
            posterUrl: 'https://image.tmdb.org/t/p/w500/fc.jpg',
            character: 'Tyler Durden',
        });
        expect(credits[2].mediaType).toBe('tv');
        // Undated entries sort last
        expect(credits[3].year).toBeNull();
    });

    it('includes directing credits from the crew, acting wins the dedup', () => {
        const credits = mapPersonFilmography(person);

        // Directed-only title appears with the job in the character slot
        const departed = credits.find((credit) => credit.tmdbId === 1422);
        expect(departed).toEqual({
            tmdbId: 1422,
            mediaType: 'movie',
            title: 'The Departed',
            year: 2006,
            posterUrl: null,
            character: 'Director',
        });

        // Non-director crew jobs (Producer) are not part of the filmography
        expect(
            credits.find((credit) => credit.tmdbId === 16869)
        ).toBeUndefined();

        // Fight Club was acted AND directed — the acting credit wins
        const fightClub = credits.find((credit) => credit.tmdbId === 550);
        expect(fightClub?.character).toBe('Tyler Durden');
    });

    it('handles a person without credits', () => {
        expect(mapPersonFilmography({ id: 1 })).toEqual([]);
    });
});
