import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { XtreamGuideExternalPlayback } from './xtream-guide-external-playback.service';
import { XtreamTuneRequests } from './xtream-tune-requests.service';

describe('Xtream tune requests', () => {
    const owner = signal({
        playlistId: 'synthetic-playlist',
        serverUrl: 'https://example.test',
        username: 'synthetic-user',
        password: 'synthetic-password',
    });
    const confirmed = signal<{
        item: { xtream_id: number };
        archive: null;
    } | null>(null);
    let requests: XtreamTuneRequests;

    beforeEach(() => {
        confirmed.set(null);
        TestBed.configureTestingModule({
            providers: [
                XtreamTuneRequests,
                {
                    provide: XtreamGuideExternalPlayback,
                    useValue: { owner, confirmed, isStopping: () => false },
                },
            ],
        });
        requests = TestBed.inject(XtreamTuneRequests);
    });

    it.each(['new tune', 'Stop', 'owner edit'] as const)(
        'retires a deferred request after %s',
        async (event) => {
            const request = requests.begin();
            const retune = jest.fn();
            const done = jest.fn();
            requests.afterCancellation(Promise.resolve(), 1, retune, done);
            expect(requests.isCurrent(request)).toBe(true);
            if (event === 'new tune') requests.begin();
            else if (event === 'Stop') requests.invalidate();
            else
                owner.update((value) => ({
                    ...value,
                    serverUrl: 'https://updated.example.test',
                }));
            expect(requests.isCurrent(request)).toBe(false);
            await Promise.resolve();
            expect(retune).not.toHaveBeenCalled();
            expect(done).not.toHaveBeenCalled();
        }
    );

    it.each([false, true])(
        'confirms only the channel still playing after cancellation (%s)',
        async (stillPlaying) => {
            requests.begin();
            if (stillPlaying)
                confirmed.set({ item: { xtream_id: 1 }, archive: null });
            const retune = jest.fn();
            const done = jest.fn();
            requests.afterCancellation(Promise.resolve(), 1, retune, done);
            expect(done).not.toHaveBeenCalled();
            await Promise.resolve();
            expect(retune).toHaveBeenCalledTimes(stillPlaying ? 0 : 1);
            expect(done).toHaveBeenCalledTimes(stillPlaying ? 1 : 0);
        }
    );

    it('drops an inline callback on Stop and consumes a valid callback once', () => {
        const stopped = jest.fn();
        requests.confirmInlineWhenReady(stopped, false);
        requests.invalidate();
        requests.confirmInline();
        expect(stopped).not.toHaveBeenCalled();
        const current = jest.fn();
        requests.confirmInlineWhenReady(current, false);
        requests.confirmInline();
        requests.confirmInline();
        expect(current).toHaveBeenCalledTimes(1);
    });
});
