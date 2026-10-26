import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
import { EpgChannelWindowLookup } from './epg-channel-window.lookup';

describe('EpgChannelWindowLookup source batches', () => {
    const urls = Array.from({ length: 51 }, (_, index) => `guide-${index}`);
    const getProgramsForChannels = jest.fn();
    const getProgramCoverage = jest.fn();
    const bridge = {
        getProgramsForChannels,
        getProgramCoverage,
    } as unknown as EpgRuntimeBridgeService;
    const lookup = new EpgChannelWindowLookup(
        bridge,
        () => [],
        () => 0
    );

    beforeEach(() => {
        getProgramsForChannels.mockReset();
        getProgramCoverage.mockReset();
    });

    it('merges programmes from every source batch before fallback', async () => {
        const first = {
            channel: 'shared-id',
            start: '2026-09-06T01:00:00.000Z',
            stop: '2026-09-06T02:00:00.000Z',
            title: 'First source',
        };
        const last = {
            ...first,
            title: 'Last source',
            start: '2026-09-06T02:00:00.000Z',
        };
        getProgramsForChannels
            .mockResolvedValueOnce({ 'shared-id': [first] })
            .mockResolvedValueOnce({ 'shared-id': [last] });

        await expect(
            lookup.programs(
                'shared-id',
                Date.UTC(2026, 8, 6),
                Date.UTC(2026, 8, 7),
                urls
            )
        ).resolves.toMatchObject([
            { title: 'First source' },
            { title: 'Last source' },
        ]);
        expect(getProgramsForChannels).toHaveBeenCalledTimes(2);
        expect(getProgramsForChannels.mock.calls[0][0].sourceUrls).toEqual(
            urls.slice(0, 50)
        );
        expect(getProgramsForChannels.mock.calls[1][0].sourceUrls).toEqual([
            urls[50],
        ]);
    });

    it('checks coverage in later source batches', async () => {
        getProgramCoverage
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(['shared-id']);
        await expect(lookup.hasAnyPrograms('shared-id', urls)).resolves.toBe(
            true
        );
        expect(getProgramCoverage).toHaveBeenCalledTimes(2);
        expect(getProgramCoverage.mock.calls[1][0].sourceUrls).toEqual([
            urls[50],
        ]);
    });
});
