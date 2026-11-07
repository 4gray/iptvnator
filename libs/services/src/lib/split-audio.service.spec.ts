import { TestBed } from '@angular/core/testing';
import {
    SPLIT_AUDIO_MAX_DELAY_SECONDS,
    SPLIT_AUDIO_PENDING_TTL_MS,
    SplitAudioService,
} from './split-audio.service';

describe('SplitAudioService', () => {
    let service: SplitAudioService;

    beforeEach(() => {
        localStorage.clear();
        TestBed.configureTestingModule({});
        service = TestBed.inject(SplitAudioService);
    });

    it('hands the pending override out exactly once', () => {
        service.request(
            { streamUrl: 'http://h/b.ts', delaySeconds: 1.5 },
            1000
        );
        expect(service.take(1500)).toEqual({
            streamUrl: 'http://h/b.ts',
            delaySeconds: 1.5,
        });
        expect(service.take(1600)).toBeNull();
    });

    it('drops an override nobody took in time', () => {
        service.request({ streamUrl: 'http://h/b.ts' }, 1000);
        expect(service.take(1000 + SPLIT_AUDIO_PENDING_TTL_MS + 1)).toBeNull();
    });

    it('clear removes a pending override', () => {
        service.request({ streamUrl: 'http://h/b.ts' });
        service.clear();
        expect(service.take()).toBeNull();
    });

    it('clamps and sanitises the delay', () => {
        expect(service.clampDelay(500)).toBe(SPLIT_AUDIO_MAX_DELAY_SECONDS);
        expect(service.clampDelay(-500)).toBe(-SPLIT_AUDIO_MAX_DELAY_SECONDS);
        expect(service.clampDelay(Number.NaN)).toBe(0);
        service.request({ streamUrl: 'x', delaySeconds: 999 }, 1);
        expect(service.take(2)?.delaySeconds).toBe(
            SPLIT_AUDIO_MAX_DELAY_SECONDS
        );
    });

    it('remembers the delay per pair without putting URLs in storage keys', () => {
        const video = 'http://h/live/user/secret/1.ts';
        const audio = 'http://h/live/user/secret/2.ts';
        service.saveDelay(video, audio, 2.25);

        expect(service.savedDelay(video, audio)).toBe(2.25);
        expect(service.savedDelay(audio, video)).toBe(0);
        const keys = Object.keys(localStorage);
        expect(keys).toHaveLength(1);
        expect(keys[0]).not.toContain('secret');
    });

    it('survives unavailable storage', () => {
        const spy = jest
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('blocked');
            });
        try {
            expect(service.savedDelay('a', 'b')).toBe(0);
        } finally {
            spy.mockRestore();
        }
    });
});
