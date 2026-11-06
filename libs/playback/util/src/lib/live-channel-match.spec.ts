import {
    LIVE_CHANNEL_MATCH_MIN_SCORE,
    liveChannelMatchScore,
    liveChannelSearchProbes,
    rankLiveChannelCandidates,
} from './live-channel-match';

describe('liveChannelMatchScore', () => {
    it.each([
        ['ERT1', 'ERT 1 HD'],
        ['ERT 1', 'GR: ERT1 FHD'],
        ['Nova Sports Prime HD', 'nova sports prime'],
        ['Mega Channel', 'MEGA CHANNEL 1080p'],
        ['Ελληνικό Κανάλι', 'ΕΛΛΗΝΙΚΌ ΚΑΝΆΛΙ HD'],
    ])('treats %p and %p as the same channel', (target, candidate) => {
        expect(liveChannelMatchScore(target, candidate)).toBeGreaterThanOrEqual(
            0.9
        );
    });

    it.each([
        ['ERT 1', 'ERT Sports 1'],
        ['Sports 1', 'ASports 1'],
        ['ERT 1', 'ERT 2'],
        ['Nova Cinema 1', 'Nova Sports 1'],
    ])(
        'never matches %p to %p, which adds or swaps a word',
        (target, candidate) => {
            expect(liveChannelMatchScore(target, candidate)).toBe(0);
        }
    );

    it.each([
        ['ESPN 2', 'ESPN'],
        ['ESPN 2', 'ESPN 3'],
        ['Nova Cinema 1', 'Nova Cinema'],
    ])(
        'never matches %p to %p without its channel number',
        (target, candidate) => {
            expect(liveChannelMatchScore(target, candidate)).toBe(0);
        }
    );

    it('accepts a shortened or abbreviated name as a partial match', () => {
        const shortened = liveChannelMatchScore(
            'Nova Sports Prime',
            'Nova Sport'
        );
        expect(shortened).toBeGreaterThanOrEqual(LIVE_CHANNEL_MATCH_MIN_SCORE);
        expect(shortened).toBeLessThan(0.9);
    });
});

describe('liveChannelSearchProbes', () => {
    it('searches the bare name first, then its longest word', () => {
        expect(liveChannelSearchProbes('GR: Nova Sports Prime HD')).toEqual([
            'nova sports prime',
            'sports',
        ]);
    });
});

describe('rankLiveChannelCandidates', () => {
    const order = ['failing', 'b', 'c', 'd'];

    it("walks the other sources in list order with each one's best match", () => {
        const ranked = rankLiveChannelCandidates(
            'ERT 1',
            [
                { playlistId: 'd', title: 'ERT1' },
                { playlistId: 'b', title: 'ERT 1 HD' },
                { playlistId: 'b', title: 'ERT1' },
                { playlistId: 'failing', title: 'ERT 1' },
                { playlistId: 'c', title: 'ERT Sports 1' },
                { playlistId: 'unknown', title: 'ERT 1' },
            ],
            order,
            'failing'
        );

        expect(ranked).toEqual([
            { playlistId: 'b', title: 'ERT1' },
            { playlistId: 'd', title: 'ERT1' },
        ]);
    });
});
