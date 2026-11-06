import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { keepSourcesChecked } from './source-status-checks';
import { SourceStatusService } from './source-status.service';

const source = (id: string, url?: string): PlaylistMeta =>
    ({
        _id: id,
        title: id,
        url,
        importDate: '',
        autoRefresh: false,
        count: 0,
    }) as PlaylistMeta;

const library = signal<PlaylistMeta[]>([]);

@Component({ selector: 'app-host', template: '' })
class HostComponent {
    constructor() {
        keepSourcesChecked(() => library());
    }
}

describe('keepSourcesChecked', () => {
    let status: {
        supportsStatusFilter: boolean;
        tracks: jest.Mock;
        ensureChecked: jest.Mock;
    };

    const mount = () => {
        TestBed.configureTestingModule({
            providers: [{ provide: SourceStatusService, useValue: status }],
        });
        const fixture = TestBed.createComponent(HostComponent);
        TestBed.tick();
        return fixture;
    };
    const signalFor = (id: string): AbortSignal =>
        status.ensureChecked.mock.calls.find(
            ([playlist]: [PlaylistMeta]) => playlist._id === id
        )?.[1];

    beforeEach(() => {
        status = {
            supportsStatusFilter: true,
            tracks: jest.fn((playlist: PlaylistMeta) => !!playlist.url),
            ensureChecked: jest.fn(),
        };
        library.set([
            source('a', 'http://a.test/list.m3u'),
            source('b', 'http://b.test/list.m3u'),
            source('local'),
        ]);
    });
    afterEach(() => TestBed.resetTestingModule());

    it('checks every network source, shown or not, once', () => {
        mount();
        expect(status.ensureChecked.mock.calls.map(([p]) => p._id)).toEqual([
            'a',
            'b',
        ]);

        // A new result elsewhere in the library starts no second check.
        library.update((list) => [...list]);
        TestBed.tick();
        expect(status.ensureChecked).toHaveBeenCalledTimes(2);
    });

    it('cancels a removed source, checks an edited one again, and stops on destroy', () => {
        const fixture = mount();
        const firstA = signalFor('a');
        library.set([
            source('a', 'http://a.test/moved.m3u'),
            source('c', 'http://c.test/list.m3u'),
        ]);
        TestBed.tick();
        expect(firstA.aborted).toBe(true);
        expect(signalFor('b').aborted).toBe(true);
        expect(status.ensureChecked).toHaveBeenCalledTimes(4);

        fixture.destroy();
        const [, , secondA, c] = status.ensureChecked.mock.calls.map(
            ([, signal]) => signal as AbortSignal
        );
        expect(secondA.aborted).toBe(true);
        expect(c.aborted).toBe(true);
    });

    it('leaves the browser build to its rows', () => {
        status.supportsStatusFilter = false;
        mount();
        expect(status.ensureChecked).not.toHaveBeenCalled();
    });
});
