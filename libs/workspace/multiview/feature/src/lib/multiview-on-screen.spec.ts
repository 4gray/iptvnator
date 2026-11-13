import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    MultiviewAnchorRegistry,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { MultiviewOnScreenSources } from './multiview-on-screen';
import { tile } from './multiview-picker.fixtures';

describe('MultiviewOnScreenSources', () => {
    const exists = signal(false);
    const view = tile({ id: 'view' });

    beforeEach(() => {
        exists.set(false);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: MultiviewSessionStore,
                    useValue: {
                        exists,
                        tiles: () => [tile({ id: 'a' }), tile({ id: 'b' })],
                    },
                },
                {
                    provide: MultiviewAnchorRegistry,
                    useValue: {
                        current: () => ({ host: { source: () => view } }),
                    },
                },
            ],
        });
    });

    it('counts the view playback as tile 1 before a session', () => {
        expect(TestBed.inject(MultiviewOnScreenSources).current()).toEqual([
            view,
        ]);
    });

    it('lists the session tiles once a session runs', () => {
        exists.set(true);

        expect(
            TestBed.inject(MultiviewOnScreenSources)
                .current()
                .map((source) => source.playbackSessionKey)
        ).toEqual(['key:a', 'key:b']);
    });
});
