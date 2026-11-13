import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
    MultiviewEntryService,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { TranslatePipe } from '@ngx-translate/core';
import { acceptChannelDrops } from './multiview-channel-drop';

/** Height of the bar under the tiles, in CSS pixels (prototype: 48). */
export const MULTIVIEW_BAR_HEIGHT = 48;

interface MultiviewChip {
    readonly id: string;
    readonly number: number;
    readonly title: string;
    readonly hasAudio: boolean;
    readonly icon: string;
}

/**
 * The multiview bar (spec 9.3, prototype steps 3–4): one chip per tile
 * with its state, the layout switch (PiP only in phase 1), "+ Channel"
 * while a source picker exists, and "Exit", which keeps the tile with
 * sound (R8).
 */
@Component({
    selector: 'app-multiview-bar',
    templateUrl: './multiview-bar.component.html',
    styleUrl: './multiview-bar.component.scss',
    imports: [MatIconModule, MatTooltipModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { role: 'toolbar', 'data-test-id': 'multiview-bar' },
})
export class MultiviewBarComponent {
    private readonly store = inject(MultiviewSessionStore);
    readonly entry = inject(MultiviewEntryService);

    readonly chips = computed<readonly MultiviewChip[]>(() =>
        this.store.tiles().map((tile, index) => {
            const hasAudio = !this.store.isMuted(tile.id);
            return {
                id: tile.id,
                number: index + 1,
                title: tile.title,
                hasAudio,
                icon:
                    tile.status === 'error'
                        ? 'warning'
                        : this.store.isHeldPaused(tile.id)
                          ? 'pause'
                          : hasAudio
                            ? 'volume_up'
                            : 'volume_off',
            };
        })
    );

    constructor() {
        // R5: a channel dropped on free player space is added.
        acceptChannelDrops((item) => void this.entry.addChannel(item));
    }

    addChannel(): void {
        void this.entry.pick();
    }

    exit(): void {
        this.store.exit();
    }
}
