import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
    MultiviewPipCorner,
    MultiviewTile,
} from '@iptvnator/playback/multiview/data-access';
import { TranslatePipe } from '@ngx-translate/core';
import { resizeHandleCorner } from './pip-drag';

/**
 * Chrome of the small PiP tile (spec 9.2, prototype step 3). At rest only
 * the picture shows; on hover or keyboard focus a label and three actions
 * appear — swap, sound here, close. The whole tile is the drag surface and
 * one corner, the one facing the stage centre, resizes it. Side by side is
 * phase 2. The surface also keeps pointer input away from the engine.
 */
@Component({
    selector: 'app-multiview-tile-chrome',
    templateUrl: './multiview-tile-chrome.component.html',
    styleUrl: './multiview-tile-chrome.component.scss',
    imports: [MatIconModule, MatTooltipModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiviewTileChromeComponent {
    readonly tile = input.required<MultiviewTile>();
    readonly tileNumber = input.required<number>();
    readonly corner = input.required<MultiviewPipCorner>();
    readonly hasAudio = input(false);
    /** Accessible name of the tile region, e.g. "Tile 2: …, muted". */
    readonly label = input('');

    readonly swapRequested = output<void>();
    readonly audioRequested = output<void>();
    readonly closeRequested = output<void>();
    readonly dragStarted = output<PointerEvent>();
    readonly resizeStarted = output<PointerEvent>();
    readonly keyPressed = output<KeyboardEvent>();

    readonly isLive = computed(() => this.tile().kind === 'live');
    readonly handleCorner = computed(() => resizeHandleCorner(this.corner()));

    onSurfacePointerDown(event: PointerEvent): void {
        if ((event.target as Element | null)?.closest('button')) return;
        this.dragStarted.emit(event);
    }

    onResizePointerDown(event: PointerEvent): void {
        event.stopPropagation();
        this.resizeStarted.emit(event);
    }
}
