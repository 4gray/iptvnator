import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import {
    ActorFilmographyCredit,
    ActorProfile,
} from '@iptvnator/services';
import {
    TitleResultsComponent,
    TitleResultsScope,
} from '../title-results/title-results.component';

/**
 * One filmography entry as rendered on the actor page. `available` marks a
 * confident catalog match (direct navigation); the rest open the portal
 * search prefilled with the title.
 */
export interface ActorViewItem extends ActorFilmographyCredit {
    available: boolean;
    /** Playlist name shown in the badge (All-portals scope) */
    availableIn?: string;
}

export type ActorViewScope = TitleResultsScope;

@Component({
    selector: 'app-actor-view',
    imports: [
        MatIcon,
        MatProgressSpinnerModule,
        TranslatePipe,
        TitleResultsComponent,
    ],
    templateUrl: './actor-view.component.html',
    styleUrls: ['./actor-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActorViewComponent {
    readonly profile = input<ActorProfile | null>(null);
    readonly items = input<ActorViewItem[]>([]);
    readonly isLoading = input(false);
    /** Cross-playlist matching in flight (All-portals scope) */
    readonly isMatching = input(false);
    /** Shows the all/in-library filter (portals with a local catalog) */
    readonly showAvailabilityFilter = input(false);
    /** Shows the this-portal/all-portals scope switch (Electron only) */
    readonly showScopeToggle = input(false);
    readonly scope = input<ActorViewScope>('portal');

    readonly itemClicked = output<ActorViewItem>();
    readonly backClicked = output<void>();
    readonly scopeChanged = output<ActorViewScope>();
}
