import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import type { UpNextRailItem } from './up-next-rail.util';

/**
 * "Up Next" side rail shown next to the inline series player when the
 * theater stage is wider than 16:9 (Netflix/Plex pattern). Purely
 * presentational: the host builds the items and handles selection.
 */
@Component({
    selector: 'app-up-next-rail',
    templateUrl: './up-next-rail.component.html',
    styleUrl: './up-next-rail.component.scss',
    imports: [MatIconModule, TranslateModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpNextRailComponent {
    readonly items = input.required<UpNextRailItem[]>();

    readonly episodeSelected = output<UpNextRailItem>();

    onSelect(item: UpNextRailItem): void {
        if (item.isPlaying) {
            return;
        }
        this.episodeSelected.emit(item);
    }
}
