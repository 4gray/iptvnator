import { NavigationEnd, NavigationStart, type Router } from '@angular/router';
import { Subject } from 'rxjs';
import { warmPlayerChunk } from './warm-player-chunk';

describe('warmPlayerChunk', () => {
    function setup(load = jest.fn(() => Promise.resolve()), navigated = false) {
        const events = new Subject<unknown>();
        const scheduled: Array<() => void> = [];
        warmPlayerChunk(
            { events, navigated } as unknown as Pick<
                Router,
                'events' | 'navigated'
            >,
            load,
            (run) => scheduled.push(run)
        );
        return { events, scheduled, load };
    }

    it('loads the players once, after the first screen has rendered', () => {
        const { events, scheduled, load } = setup();

        events.next(new NavigationStart(1, '/workspace'));
        expect(scheduled).toHaveLength(0);

        events.next(new NavigationEnd(1, '/workspace', '/workspace/dashboard'));
        events.next(
            new NavigationEnd(2, '/workspace/sources', '/workspace/sources')
        );
        expect(scheduled).toHaveLength(1);
        expect(load).not.toHaveBeenCalled();

        scheduled[0]();
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('warms at once when the first navigation is already over', () => {
        const { events, scheduled, load } = setup(undefined, true);
        expect(scheduled).toHaveLength(1);

        events.next(
            new NavigationEnd(2, '/workspace/sources', '/workspace/sources')
        );
        expect(scheduled).toHaveLength(1);
        scheduled[0]();
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('leaves a failed warm-up to the route that needs the players', async () => {
        const load = jest.fn(() => Promise.reject(new Error('offline')));
        const { events, scheduled } = setup(load);

        events.next(new NavigationEnd(1, '/', '/workspace/dashboard'));
        expect(() => scheduled[0]()).not.toThrow();
        await Promise.resolve();
        expect(load).toHaveBeenCalledTimes(1);
    });
});
