import { isSelectedEpgDayToday } from './multi-epg-container.component';

describe('isSelectedEpgDayToday', () => {
    it('returns true only when the selected EPG day is the actual current day', () => {
        const now = new Date('2026-05-21T20:00:00.000Z');

        expect(isSelectedEpgDayToday('20260521', now)).toBe(true);
        expect(isSelectedEpgDayToday('20260520', now)).toBe(false);
        expect(isSelectedEpgDayToday('20260522', now)).toBe(false);
    });
});
