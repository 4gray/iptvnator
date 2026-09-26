import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import type { PlayerUpNextItem } from './player-controls.model';

/**
 * The "Up next" card in the player's bottom-right corner: thumbnail, the
 * minutes left, the next episode's label and title. One click plays it
 * through the host's ordinary next-episode path, so fullscreen survives.
 */
@Component({
    selector: 'app-player-up-next-card',
    templateUrl: './player-up-next-card.component.html',
    styleUrl: './player-up-next-card.component.scss',
    imports: [MatIconModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'player-up-next',
        '[class.player-up-next--compact]': 'compact()',
    },
})
export class PlayerUpNextCardComponent {
    readonly item = input.required<PlayerUpNextItem>();
    readonly minutesLeft = input.required<number>();
    readonly compact = input(false);
    readonly selected = output<void>();
}
