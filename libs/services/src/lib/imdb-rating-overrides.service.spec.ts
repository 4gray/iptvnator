import { ImdbRatingOverridesService } from './imdb-rating-overrides.service';

describe('ImdbRatingOverridesService', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
    });

    afterEach(() => {
        localStorage.clear();
        jest.useRealTimers();
    });

    it('persists normalized IMDb rating overrides', () => {
        const service = new ImdbRatingOverridesService();

        service.setOverride('vod:123', {
            imdbId: 'https://www.imdb.com/title/tt0241527/',
            rating: 8.95,
            title: 'Harry Potter and the Philosopher Stone',
            year: 2001,
        });

        const secondService = new ImdbRatingOverridesService();
        expect(secondService.getOverride('vod:123')).toEqual({
            imdbId: 'tt0241527',
            rating: 8.95,
            title: 'Harry Potter and the Philosopher Stone',
            year: 2001,
            updatedAt: '2026-05-14T12:00:00.000Z',
        });
    });

    it('can clear one override or every override', () => {
        const service = new ImdbRatingOverridesService();
        service.setOverride('vod:123', { rating: 8 });
        service.setOverride('series:456', { rating: 9 });

        service.clearOverride('vod:123');
        expect(service.getOverride('vod:123')).toBeNull();
        expect(service.getOverride('series:456')?.rating).toBe(9);

        service.clearAll();
        expect(service.getOverride('series:456')).toBeNull();
    });
});
