import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import { M3uRecentlyViewedRecorder } from '../m3u-recently-viewed.recorder';
import { M3uEpisodeAccessService } from './m3u-episode-access.service';

const EPISODE = {
    id: 'row-1',
    url: 'http://h.example/series/u/p/1.mp4',
    name: 'Harbor Lights S01E01',
    group: { title: 'Locked Shows' },
} as unknown as Channel;

describe('M3uEpisodeAccessService', () => {
    const locked = new Set<string>();
    const lock = {
        version: signal(0),
        isM3uGroupLocked: jest.fn((_id: string, group: string) =>
            locked.has(group)
        ),
        requestUnlock: jest.fn(async () => {
            locked.clear();
            return true;
        }),
    };
    const gate = { defer: jest.fn() };
    const recorder = { persist: jest.fn().mockResolvedValue(undefined) };
    let service: M3uEpisodeAccessService;

    beforeEach(() => {
        locked.clear();
        jest.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [
                M3uEpisodeAccessService,
                { provide: ParentalLockService, useValue: lock },
                { provide: PlaybackHistoryGate, useValue: gate },
                { provide: M3uRecentlyViewedRecorder, useValue: recorder },
            ],
        });
        service = TestBed.inject(M3uEpisodeAccessService);
    });

    it('reads the lock by the row’s own group', () => {
        locked.add('Locked Shows');

        expect(service.isWithheld('pl-1', EPISODE)).toBe(true);
        expect(lock.isM3uGroupLocked).toHaveBeenCalledWith(
            'pl-1',
            'Locked Shows'
        );
    });

    it('grants access once the PIN unlocks the group', async () => {
        locked.add('Locked Shows');

        await expect(service.requestAccess('pl-1', EPISODE)).resolves.toBe(
            true
        );
    });

    it('refuses access when the group stays locked', async () => {
        locked.add('Locked Shows');
        lock.requestUnlock.mockResolvedValueOnce(false);

        await expect(service.requestAccess('pl-1', EPISODE)).resolves.toBe(
            false
        );
    });

    it('writes history only when the gate confirms playback', () => {
        service.recordWhenPlayed('pl-1', EPISODE, 'session-1');

        expect(gate.defer).toHaveBeenCalledWith(
            {
                sourceId: 'pl-1',
                sessionKey: 'session-1',
                streamUrls: [EPISODE.url],
            },
            expect.any(Function)
        );
        expect(recorder.persist).not.toHaveBeenCalled();

        const commit = gate.defer.mock.calls[0][1] as () => void;
        commit();

        expect(recorder.persist).toHaveBeenCalledWith('pl-1', EPISODE);
    });
});
