import {
    DestroyRef,
    Directive,
    ElementRef,
    computed,
    effect,
    inject,
    input,
} from '@angular/core';
import {
    MULTIVIEW_CHANNEL_MAPPER,
    MultiviewChannelDrag,
    MultiviewEntryService,
    MultiviewSessionStore,
    tileNumberFor,
} from '@iptvnator/playback/multiview/data-access';
import { ChannelListItemComponent } from './channel-list-item.component';

/**
 * Multiview on a channel row (spec 9.4, R5), for lists that provide
 * `MULTIVIEW_CHANNEL_MAPPER`: the row shows its tile number (and a speaker
 * for the audio tile) while it is on screen, Alt+click adds it as a tile
 * instead of selecting it, and it can be dragged onto the player. Without
 * a mapper, or while multiview is not available, the row is unchanged: a
 * plain click and the list's own `cdkDrag` reordering keep their path.
 */
@Directive({
    selector: 'app-channel-list-item[appMultiviewChannel]',
    host: { '[attr.draggable]': 'draggable() ? "true" : null' },
})
export class MultiviewChannelDirective {
    readonly appMultiviewChannel = input<unknown>(null);

    private readonly mapper = inject(MULTIVIEW_CHANNEL_MAPPER, {
        optional: true,
    });
    private readonly store = inject(MultiviewSessionStore);
    private readonly entry = inject(MultiviewEntryService);
    private readonly drag = inject(MultiviewChannelDrag);
    /** Absent where a test stands in for the row: then nothing happens. */
    private readonly row = inject(ChannelListItemComponent, {
        optional: true,
    });

    readonly item = computed(() => {
        const row = this.appMultiviewChannel();
        const item = row && this.mapper ? this.mapper(row) : null;
        return item?.contentType === 'live' && item.radio !== 'true'
            ? item
            : null;
    });
    /** Native drag only where the list does not reorder with `cdkDrag`. */
    readonly draggable = computed(
        () =>
            !!this.item() &&
            !!this.row &&
            !this.row.isDraggable() &&
            this.entry.canAddChannel()
    );

    constructor() {
        const row = this.row;
        if (!row) return;
        effect(() => {
            const item = this.item();
            const tiles = this.store.tiles();
            const number = item ? tileNumberFor(item, tiles) : null;
            row.multiviewTile.set(
                number === null
                    ? null
                    : {
                          number,
                          audio:
                              tiles[number - 1]?.id ===
                              this.store.audioTileId(),
                      }
            );
        });
        if (!this.mapper) return;
        const element: HTMLElement = inject(ElementRef).nativeElement;
        const onClick = (event: MouseEvent): void => this.onClick(event);
        const onDragStart = (event: DragEvent): void => {
            const item = this.item();
            if (item && this.draggable()) {
                this.drag.start(item, event.dataTransfer);
            }
        };
        const onDragEnd = (): void => this.drag.end();
        // Capture: an Alt+click is taken before the row's own click path.
        element.addEventListener('click', onClick, true);
        element.addEventListener('dragstart', onDragStart);
        element.addEventListener('dragend', onDragEnd);
        inject(DestroyRef).onDestroy(() => {
            element.removeEventListener('click', onClick, true);
            element.removeEventListener('dragstart', onDragStart);
            element.removeEventListener('dragend', onDragEnd);
        });
    }

    private onClick(event: MouseEvent): void {
        const item = this.item();
        if (!event.altKey || !item || this.row?.disabled()) return;
        if (!this.entry.canAddChannel()) return;
        event.preventDefault();
        event.stopPropagation();
        void this.entry.addChannel(item);
    }
}
