import { Component, ElementRef, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
    SecondStreamEpgService,
    type SecondStreamChannel,
} from '@iptvnator/portal/shared/data-access';
import {
    EpgPreferencesService,
    EpgSourceSettingsService,
    SettingsStore,
} from '@iptvnator/services';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { Subject } from 'rxjs';
import { SecondStreamPickerEpg } from './second-stream-picker-epg';

@Component({ template: '' })
class EpgHarness {
    readonly rows = signal<SecondStreamChannel[]>([]);
    readonly elements = signal<ElementRef<HTMLElement>[]>([]);
    readonly list = signal<ElementRef<HTMLElement> | undefined>(undefined);
    readonly epg = new SecondStreamPickerEpg(
        this.rows,
        this.elements,
        this.list
    );
}

type Intersection = Pick<
    IntersectionObserverEntry,
    'target' | 'isIntersecting'
>;

class TestIntersectionObserver {
    readonly observe = jest.fn();
    readonly disconnect = jest.fn();

    constructor(readonly callback: (entries: Intersection[]) => void) {}

    show(target: HTMLElement): void {
        this.callback([{ target, isIntersecting: true }]);
    }

    hide(target: HTMLElement): void {
        this.callback([{ target, isIntersecting: false }]);
    }
}

const xmltvRow: SecondStreamChannel = {
    group: '',
    item: {
        uid: 'fixture-xmltv',
        name: 'Fixture XMLTV',
        playlistId: 'fixture-playlist',
        playlistName: 'Fixture playlist',
        sourceType: 'm3u',
        contentType: 'live',
    },
};

describe('SecondStreamPickerEpg', () => {
    let fixture: ComponentFixture<EpgHarness>;
    let harness: EpgHarness;
    let observers: TestIntersectionObserver[];
    let enabled: ReturnType<typeof signal<boolean>>;
    let revision: ReturnType<typeof signal<number>>;
    let offset: ReturnType<typeof signal<number>>;
    let xmltvAvailable: Subject<boolean>;
    let load: jest.Mock;
    let program: EpgProgram;
    const observerDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'IntersectionObserver'
    );

    beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2026-01-01T12:00:00Z') });
        observers = [];
        Object.defineProperty(globalThis, 'IntersectionObserver', {
            configurable: true,
            value: class extends TestIntersectionObserver {
                constructor(callback: (entries: Intersection[]) => void) {
                    super(callback);
                    observers.push(this);
                }
            },
        });
        enabled = signal(true);
        revision = signal(0);
        offset = signal(0);
        xmltvAvailable = new Subject<boolean>();
        load = jest.fn().mockResolvedValue(new Map());
        program = {
            channel: 'fixture-guide-id',
            title: 'Fixture current programme',
            start: '2026-01-01T11:59:00Z',
            stop: '2026-01-01T12:01:00Z',
            desc: null,
            category: null,
        };
        TestBed.configureTestingModule({
            imports: [EpgHarness],
            providers: [
                {
                    provide: SecondStreamEpgService,
                    useValue: { xmltvAvailable$: xmltvAvailable, load },
                },
                { provide: EpgPreferencesService, useValue: { enabled } },
                { provide: EpgSourceSettingsService, useValue: { revision } },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: offset },
                },
            ],
        });
        fixture = TestBed.createComponent(EpgHarness);
        harness = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
        if (observerDescriptor) {
            Object.defineProperty(
                globalThis,
                'IntersectionObserver',
                observerDescriptor
            );
        } else {
            Reflect.deleteProperty(globalThis, 'IntersectionObserver');
        }
        jest.useRealTimers();
    });

    function renderRows(rows: SecondStreamChannel[]): HTMLElement[] {
        const list = document.createElement('div');
        const elements = rows.map(({ item }) => {
            const element = document.createElement('div');
            element.dataset['epgRow'] = item.uid;
            list.append(element);
            return element;
        });
        harness.rows.set(rows);
        harness.elements.set(
            elements.map((element) => new ElementRef(element))
        );
        harness.list.set(new ElementRef(list));
        fixture.detectChanges();
        return elements;
    }

    async function renderPreviews(): Promise<void> {
        fixture.detectChanges();
        await Promise.resolve();
        await Promise.resolve();
        fixture.detectChanges();
    }

    it('loads only visible rows and batches the XMLTV and portal lookups', async () => {
        const portals: SecondStreamChannel[] = Array.from(
            { length: 5 },
            (_, index) => ({
                ...xmltvRow,
                item: {
                    ...xmltvRow.item,
                    uid: `fixture-portal-${index}`,
                    sourceType: 'xtream',
                },
            })
        );
        load.mockResolvedValue(new Map([[xmltvRow.item.uid, program]]));
        const elements = renderRows([xmltvRow, ...portals]);
        const observer = observers[0];
        expect(observer.observe.mock.calls.map(([element]) => element)).toEqual(
            elements
        );
        expect(load).not.toHaveBeenCalled();

        observer.show(document.createElement('div'));
        elements.forEach((element) => observer.show(element));
        observer.hide(elements[5]);
        await renderPreviews();
        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith([xmltvRow, ...portals.slice(0, 4)]);
        expect(harness.epg.program(xmltvRow.item.uid)).toBe(program);
        expect(harness.epg.progress(program)).toBe(50);
        expect(harness.epg.progress(null)).toBe(0);
        expect(harness.epg.program(portals[0].item.uid)).toBeNull();

        observer.show(elements[5]);
        await renderPreviews();
        expect(load).toHaveBeenLastCalledWith([portals[4]]);
    });

    it('drops an old guide result after source settings change and refreshes expired previews', async () => {
        let finish!: (programs: Map<string, EpgProgram>) => void;
        const old = { ...program, title: 'Fixture stale programme' };
        load.mockImplementationOnce(
            () =>
                new Promise<Map<string, EpgProgram>>((resolve) => {
                    finish = resolve;
                })
        )
            .mockResolvedValueOnce(new Map([[xmltvRow.item.uid, program]]))
            .mockRejectedValueOnce(new Error('Guide unavailable'));
        const [element] = renderRows([xmltvRow]);
        observers[0].show(element);
        await renderPreviews();
        expect(load).toHaveBeenCalledTimes(1);

        revision.update((value) => value + 1);
        finish(new Map([[xmltvRow.item.uid, old]]));
        await renderPreviews();
        expect(harness.epg.program(xmltvRow.item.uid)).toBeNull();
        await renderPreviews();
        expect(load).toHaveBeenCalledTimes(2);
        expect(harness.epg.program(xmltvRow.item.uid)).toBe(program);

        await jest.advanceTimersByTimeAsync(60_000);
        await renderPreviews();
        expect(load).toHaveBeenCalledTimes(3);
        expect(harness.epg.program(xmltvRow.item.uid)).toBeNull();
        await renderPreviews();
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('reloads for a newly available XMLTV guide and stops when EPG is disabled', async () => {
        load.mockResolvedValue(new Map([[xmltvRow.item.uid, program]]));
        const [element] = renderRows([xmltvRow]);
        observers[0].show(element);
        await renderPreviews();
        xmltvAvailable.next(false);
        await renderPreviews();
        expect(load).toHaveBeenCalledTimes(1);
        xmltvAvailable.next(true);
        await renderPreviews();
        expect(load).toHaveBeenCalledTimes(2);

        enabled.set(false);
        await renderPreviews();
        expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
        expect(harness.epg.program(xmltvRow.item.uid)).toBeNull();
        harness.epg.stop();
        enabled.set(true);
        offset.set(30);
        await renderPreviews();
        expect(load).toHaveBeenCalledTimes(2);
        expect(observers).toHaveLength(1);
    });
});
