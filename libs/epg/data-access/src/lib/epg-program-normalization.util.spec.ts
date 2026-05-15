import { EpgProgram } from '@iptvnator/shared/interfaces';
import { normalizeEpgPrograms } from './epg-program-normalization.util';

function buildProgram(overrides: Partial<EpgProgram> = {}): EpgProgram {
    return {
        start: '2026-04-15T20:00:00Z',
        stop: '2026-04-15T21:00:00Z',
        channel: 'channel-1',
        title: 'Sample',
        desc: null,
        category: null,
        iconUrl: null,
        rating: null,
        episodeNum: null,
        ...overrides,
    };
}

describe('normalizeEpgPrograms', () => {
    it('keeps valid rows and normalizes dates', () => {
        expect(normalizeEpgPrograms([buildProgram()])).toEqual([
            expect.objectContaining({
                start: '2026-04-15T20:00:00.000Z',
                stop: '2026-04-15T21:00:00.000Z',
            }),
        ]);
    });

    it('drops rows with invalid stop dates', () => {
        expect(
            normalizeEpgPrograms([
                buildProgram({ title: 'ok' }),
                buildProgram({ title: 'bad', stop: '' }),
            ])
        ).toEqual([expect.objectContaining({ title: 'ok' })]);
    });
});
