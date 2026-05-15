import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from '@iptvnator/ui/components';
import { EpgItem } from '@iptvnator/shared/interfaces';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { EpgViewComponent } from '@iptvnator/ui/shared-portals';
import { PortalEmptyStateComponent } from '../portal-empty-state/portal-empty-state.component';

@Component({
    selector: 'app-portal-collection-live-shell',
    imports: [
        EpgViewComponent,
        MatButtonModule,
        MatProgressSpinnerModule,
        PortalEmptyStateComponent,
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    templateUrl: './portal-collection-live-shell.component.html',
    styleUrl: './portal-collection-live-shell.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalCollectionLiveShellComponent {
    readonly title = input<string>('Favorites');
    readonly subtitle = input<string>('Live TV');
    readonly count = input<number>(0);
    readonly streamUrl = input<string>('');
    readonly isEmbeddedPlayer = input<boolean>(true);
    readonly hasSelection = input<boolean>(false);
    readonly epgItems = input<EpgItem[]>([]);
    readonly isLoadingEpg = input<boolean>(false);
    readonly hasMoreEpg = input<boolean>(false);

    readonly loadMoreEpgClicked = output<void>();

    onLoadMoreEpg(): void {
        this.loadMoreEpgClicked.emit();
    }
}
