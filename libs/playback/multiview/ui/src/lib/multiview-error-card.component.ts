import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
    type MultiviewConnectionBudget,
    type MultiviewPipCorner,
    MultiviewEntryService,
    MultiviewSessionStore,
    type MultiviewTile,
} from '@iptvnator/playback/multiview/data-access';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import { TranslatePipe } from '@ngx-translate/core';
import { multiviewErrorCopy } from './multiview-error-copy';
import type { StageSize, TileBox } from './pip-geometry';

/** The card is wider than a small tile, so it fits its sentence (spec 9.6). */
const CARD_WIDTH = 400;
const CARD_INSET = 16;

/**
 * A failed small tile (spec 9.6, prototype step 9): the card grows from the
 * tile's corner over the video and explains what happened, with "Replace
 * main tile" (one stream instead of two), "Choose another source" (while a
 * picker exists) and "Close".
 */
@Component({
    selector: 'app-multiview-error-card',
    templateUrl: './multiview-error-card.component.html',
    styleUrl: './multiview-error-card.component.scss',
    imports: [MatIconModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        role: 'alertdialog',
        'data-test-id': 'multiview-error-card',
        '[attr.aria-labelledby]': '"mv-error-" + tile().id',
        '[style.width.px]': 'width()',
        '[style.left.px]': 'corner().endsWith("left") ? box().left : null',
        '[style.right.px]':
            'corner().endsWith("right") ? stage().width - box().left - box().width : null',
        '[style.top.px]': 'corner().startsWith("top") ? box().top : null',
        '[style.bottom.px]':
            'corner().startsWith("bottom") ? stage().height - box().top - box().height : null',
    },
})
export class MultiviewErrorCardComponent {
    readonly tile = input.required<MultiviewTile>();
    readonly diagnostic = input<PlaybackDiagnostic | null>(null);
    readonly budget = input<MultiviewConnectionBudget | null>(null);
    readonly corner = input.required<MultiviewPipCorner>();
    /** The failed tile's box in the tile area. */
    readonly box = input.required<TileBox>();
    readonly stage = input.required<StageSize>();

    private readonly store = inject(MultiviewSessionStore);
    readonly entry = inject(MultiviewEntryService);
    readonly copy = computed(() =>
        multiviewErrorCopy(this.diagnostic(), this.budget())
    );
    readonly width = computed(() =>
        Math.max(
            this.box().width,
            Math.min(CARD_WIDTH, this.stage().width - 2 * CARD_INSET)
        )
    );

    /** Stop the main tile and play this one instead: one stream, not two. */
    replaceMain(): void {
        const main = this.store.tiles()[0];
        this.store.setAudio(this.tile().id);
        if (main && main.id !== this.tile().id) this.store.remove(main.id);
    }

    chooseAnother(): void {
        void this.entry.pick({ context: 'replace', tileId: this.tile().id });
    }

    close(): void {
        this.store.remove(this.tile().id);
    }
}
