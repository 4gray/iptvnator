import { TestBed } from '@angular/core/testing';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { UnifiedRecentDataService } from '@iptvnator/portal/shared/data-access';
import { MultiviewChannelAdder } from './multiview-channel-adder.service';
import { MultiviewRelockGuard } from './multiview-relock-guard.service';
import { liveItem, movieItem } from './multiview-picker.fixtures';
import {
    MultiviewTileResolverService,
    MultiviewUnresolvableError,
} from './multiview-tile-resolver';

describe('MultiviewChannelAdder', () => {
    const resolve = jest.fn();
    const defer = jest.fn();
    const track = jest.fn();

    beforeEach(() => {
        jest.resetAllMocks();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: MultiviewTileResolverService,
                    useValue: { resolve },
                },
                { provide: PlaybackHistoryGate, useValue: { defer } },
                { provide: MultiviewRelockGuard, useValue: { track } },
                {
                    provide: UnifiedRecentDataService,
                    useValue: { recordLivePlayback: jest.fn() },
                },
            ],
        });
    });

    const adder = () => TestBed.inject(MultiviewChannelAdder);

    it('resolves a live row like the picker and records it once it plays', async () => {
        const source = {
            playback: {
                streamUrl: 'https://stream.example/7.m3u8',
                title: 't',
            },
            playbackSessionKey: 'key-7',
        };
        resolve.mockResolvedValue(source);

        await expect(adder().resolve(liveItem(7))).resolves.toBe(source);
        expect(resolve).toHaveBeenCalledWith(
            expect.objectContaining({ item: liveItem(7), kind: 'live' })
        );
        expect(defer).toHaveBeenCalledWith(
            expect.objectContaining({ sessionKey: 'key-7' }),
            expect.any(Function)
        );
    });

    it.each([
        ['a film', movieItem(4)],
        ['radio', liveItem(8, { radio: 'true' })],
    ])('refuses %s', async (_label, item) => {
        await expect(adder().resolve(item)).rejects.toBeInstanceOf(
            MultiviewUnresolvableError
        );
        expect(resolve).not.toHaveBeenCalled();
    });
});
