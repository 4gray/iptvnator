import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from 'components';
import { EpgItem } from 'shared-interfaces';
import { EpgViewComponent, WebPlayerViewComponent } from 'shared-portals';

@Component({
    selector: 'app-portal-collection-live-shell',
    imports: [
        EpgViewComponent,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
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
