import { MomentDatePipe } from './moment-date.pipe';

describe('MomentDatePipe', () => {
    let pipe: MomentDatePipe;

    beforeEach(() => {
        pipe = new MomentDatePipe();
    });

    it('formats ISO strings using the requested output format', () => {
        expect(pipe.transform('2026-03-28T12:00:00.000Z', 'YYYY-MM-DD')).toBe(
            '2026-03-28'
        );
    });

    it('supports explicit parse formats for non-ISO values', () => {
        expect(
            pipe.transform('28/03/2026', 'YYYY-MM-DD', 'DD/MM/YYYY')
        ).toBe('2026-03-28');
    });
});
