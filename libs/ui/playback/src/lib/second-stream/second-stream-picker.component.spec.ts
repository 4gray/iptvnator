import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    SecondStreamCatalogService,
    SecondStreamChannel,
} from '@iptvnator/portal/shared/data-access';
import { EmbeddedMpvOverlayVisibilityService } from '../embedded-mpv-player/embedded-mpv-overlay-visibility.service';
import { SecondStreamPickerComponent } from './second-stream-picker.component';

const row: SecondStreamChannel = {
    group: 'News',
    item: {
        uid: 'synthetic',
        name: 'Synthetic News',
        sourceType: 'm3u',
        contentType: 'live',
        playlistId: 'p',
        playlistName: 'Synthetic source',
    },
};
describe('SecondStreamPickerComponent', () => {
    let load: jest.Mock;
    let resolve: jest.Mock;
    let loadGroup: jest.Mock;
    let component: SecondStreamPickerComponent;
    beforeEach(() => {
        load = jest.fn().mockResolvedValue({ groups: [], channels: [row] });
        resolve = jest.fn();
        loadGroup = jest.fn().mockResolvedValue([row]);
        TestBed.configureTestingModule({
            imports: [SecondStreamPickerComponent],
            providers: [
                {
                    provide: SecondStreamCatalogService,
                    useValue: {
                        version: signal(0),
                        sources: jest.fn().mockResolvedValue([]),
                        load,
                        resolve,
                        loadGroup,
                    },
                },
                {
                    provide: EmbeddedMpvOverlayVisibilityService,
                    useValue: { acquireExternalModalSurface: () => jest.fn() },
                },
            ],
        });
        TestBed.overrideComponent(SecondStreamPickerComponent, {
            set: { template: '' },
        });
        component = TestBed.createComponent(
            SecondStreamPickerComponent
        ).componentInstance;
    });
    it('ignores a stale source response and aborts its request', async () => {
        let finish!: (value: unknown) => void;
        load.mockImplementationOnce(() => new Promise((r) => (finish = r)));
        const first = component.reload();
        const signal = load.mock.calls[0][1] as AbortSignal;
        component.source.set('other');
        await component.reload();
        finish({ groups: [], channels: [] });
        await first;
        expect(signal.aborted).toBe(true);
        expect(component.data().channels).toEqual([row]);
    });
    it('does not open a channel whose resolution finishes after source changes', async () => {
        let finish!: (value: unknown) => void;
        resolve.mockImplementation(() => new Promise((r) => (finish = r)));
        const selected = jest.spyOn(component.selected, 'emit');
        const pending = component.choose(row);
        await component.reload();
        finish({ streamUrl: 'https://media.example.test/live' });
        await pending;
        expect(selected).not.toHaveBeenCalled();
    });
    it('searches the full source before limiting rendered rows', async () => {
        await component.reload();
        component.data.set({
            groups: [],
            channels: Array.from({ length: 150 }, (_, i) => ({
                ...row,
                item: { ...row.item, uid: String(i), name: `Channel ${i}` },
            })),
        });
        expect(component.visible()).toHaveLength(100);
        component.search.set('Channel 149');
        expect(component.visible().map((r) => r.item.name)).toEqual([
            'Channel 149',
        ]);
    });
    it('offers retry after load failure and keeps playback failures inside the picker', async () => {
        load.mockRejectedValueOnce(new Error('synthetic failure'));
        await component.reload();
        expect(component.error()).toBe('load');
        await component.reload();
        expect(component.error()).toBeNull();
        resolve.mockRejectedValue(new Error('synthetic unavailable'));
        await component.choose(row);
        expect(component.error()).toBe('play');
        expect(component.resolving()).toBeNull();
    });
    it('shows the remaining channels when a refreshed catalog withholds the selected group', async () => {
        component.group.set('Unavailable');
        load.mockResolvedValueOnce({
            groups: [{ id: 'News', name: 'News' }],
            channels: [row],
        });

        await component.reload();

        expect(component.group()).toBeNull();
        expect(component.visible()).toEqual([row]);
    });

    it('reloads a selected genre whose channels are fetched on demand', async () => {
        component.source.set('synthetic-source');
        component.group.set('News');
        load.mockResolvedValueOnce({
            groups: [{ id: 'News', name: 'News' }],
            channels: [],
        });

        await component.reload();

        expect(component.group()).toBe('News');
        expect(component.visible()).toEqual([row]);
        expect(component.loading()).toBe(false);
        expect(component.groupLoading()).toBe(false);
    });

    it('loads an omitted genre and ignores its response after changing source', async () => {
        let finish!: (value: unknown) => void;
        loadGroup.mockImplementationOnce(
            () => new Promise((r) => (finish = r))
        );
        const pending = component.selectGroup('News');
        const signal = loadGroup.mock.calls[0][2] as AbortSignal;
        await component.reload();
        finish([{ ...row, group: 'stale' }]);
        await pending;
        expect(signal.aborted).toBe(true);
        expect(component.data().channels).toEqual([row]);
        component.data.set({ groups: [], channels: [] });
        await component.selectGroup('News');
        expect(component.visible()).toEqual([row]);
        expect(component.groupLoading()).toBe(false);
    });
});
