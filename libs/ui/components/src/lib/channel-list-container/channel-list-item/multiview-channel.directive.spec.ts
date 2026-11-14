import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    MULTIVIEW_CHANNEL_DRAG_TYPE,
    MULTIVIEW_CHANNEL_MAPPER,
    MultiviewChannelDrag,
    MultiviewEntryService,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { EpgProgrammeDialogService } from '@iptvnator/ui/epg';
import { TranslateModule } from '@ngx-translate/core';
import { ChannelListItemComponent } from './channel-list-item.component';
import { MultiviewChannelDirective } from './multiview-channel.directive';

const item: UnifiedCollectionItem = {
    uid: 'xtream::playlist-1::live:7',
    name: 'Synthetic Channel 7',
    contentType: 'live',
    sourceType: 'xtream',
    playlistId: 'playlist-1',
    playlistName: 'Synthetic Provider',
    xtreamId: 7,
};

@Component({
    template: `<app-channel-list-item
        [appMultiviewChannel]="row()"
        name="Synthetic Channel 7"
        [isDraggable]="reorder()"
        (clicked)="clicked()"
    />`,
    imports: [ChannelListItemComponent, MultiviewChannelDirective],
})
class HostComponent {
    readonly row = signal<unknown>({ id: 7 });
    readonly reorder = signal(false);
    readonly clicked = jest.fn();
}

describe('MultiviewChannelDirective', () => {
    let fixture: ComponentFixture<HostComponent>;
    const tiles = signal<unknown[]>([]);
    const audioTileId = signal<string | null>(null);
    const canAddChannel = signal(true);
    const addChannel = jest.fn();

    function create(withMapper = true): void {
        TestBed.configureTestingModule({
            imports: [
                HostComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: EpgProgrammeDialogService,
                    useValue: { open: jest.fn() },
                },
                {
                    provide: MultiviewSessionStore,
                    useValue: { tiles, audioTileId },
                },
                {
                    provide: MultiviewEntryService,
                    useValue: { canAddChannel, addChannel },
                },
                ...(withMapper
                    ? [
                          {
                              provide: MULTIVIEW_CHANNEL_MAPPER,
                              useValue: (row: unknown) => (row ? item : null),
                          },
                      ]
                    : []),
            ],
        });
        fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
    }

    beforeEach(() => {
        tiles.set([]);
        audioTileId.set(null);
        canAddChannel.set(true);
        addChannel.mockReset();
    });

    afterEach(() => fixture.destroy());

    const host = (): HTMLElement =>
        fixture.nativeElement.querySelector('app-channel-list-item');
    const row = (): HTMLElement =>
        fixture.nativeElement.querySelector('.channel-list-item');
    const badge = () =>
        fixture.nativeElement.querySelector(
            '[data-test-id="multiview-tile-badge"]'
        ) as HTMLElement | null;
    const click = (init: MouseEventInit = {}) =>
        row().dispatchEvent(
            new MouseEvent('click', { bubbles: true, detail: 1, ...init })
        );

    it('shows the tile number while the channel is on screen (spec 9.4)', () => {
        create();
        expect(badge()).toBeNull();

        tiles.set([
            {
                id: 'multiview-tile-1',
                playbackSessionKey: 'a',
                kind: 'live',
                playlistId: 'playlist-1',
                contentId: '3',
                playback: { streamUrl: 'x' },
            },
            {
                id: 'multiview-tile-2',
                playbackSessionKey: 'b',
                kind: 'live',
                playlistId: 'playlist-1',
                contentId: '7',
                playback: { streamUrl: 'y' },
            },
        ]);
        fixture.detectChanges();
        expect(badge()?.textContent?.trim()).toBe('2');
        expect(badge()?.classList).not.toContain('multiview-tile-badge--audio');

        audioTileId.set('multiview-tile-2');
        fixture.detectChanges();
        expect(badge()?.classList).toContain('multiview-tile-badge--audio');
        expect(badge()?.textContent).toContain('volume_up');
    });

    it('adds the channel on Alt+click instead of selecting it (R5)', () => {
        create();

        click({ altKey: true });

        expect(addChannel).toHaveBeenCalledWith(item);
        expect(fixture.componentInstance.clicked).not.toHaveBeenCalled();
    });

    it('keeps a plain click on the row path', () => {
        create();

        click();

        expect(fixture.componentInstance.clicked).toHaveBeenCalledTimes(1);
        expect(addChannel).not.toHaveBeenCalled();
    });

    it('leaves Alt+click to the row while multiview cannot take it', () => {
        create();
        canAddChannel.set(false);

        click({ altKey: true });

        expect(addChannel).not.toHaveBeenCalled();
        expect(fixture.componentInstance.clicked).toHaveBeenCalledTimes(1);
    });

    it('drags the channel only where the list does not reorder its rows', () => {
        create();
        expect(host().getAttribute('draggable')).toBe('true');
        const transfer = {
            setData: jest.fn(),
            effectAllowed: 'none',
        } as unknown as DataTransfer;
        const start = new Event('dragstart') as DragEvent;
        Object.defineProperty(start, 'dataTransfer', { value: transfer });
        host().dispatchEvent(start);
        expect(transfer.setData).toHaveBeenCalledWith(
            MULTIVIEW_CHANNEL_DRAG_TYPE,
            expect.any(String)
        );
        expect(TestBed.inject(MultiviewChannelDrag)).toBeTruthy();

        fixture.componentInstance.reorder.set(true);
        fixture.detectChanges();
        expect(host().getAttribute('draggable')).toBeNull();

        fixture.componentInstance.reorder.set(false);
        canAddChannel.set(false);
        fixture.detectChanges();
        expect(host().getAttribute('draggable')).toBeNull();
    });

    it('changes nothing for a list without a mapper', () => {
        create(false);
        tiles.set([
            {
                id: 'multiview-tile-1',
                playbackSessionKey: 'a',
                kind: 'live',
                playlistId: 'playlist-1',
                contentId: '7',
                playback: { streamUrl: 'x' },
            },
        ]);
        fixture.detectChanges();

        click({ altKey: true });

        expect(badge()).toBeNull();
        expect(host().getAttribute('draggable')).toBeNull();
        expect(addChannel).not.toHaveBeenCalled();
        expect(fixture.componentInstance.clicked).toHaveBeenCalledTimes(1);
    });
});
