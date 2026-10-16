import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    SettingsSearchEntry,
    SettingsSearchResult,
} from '@iptvnator/workspace/shell/util/settings-search';

/**
 * Ranked settings matches for the header search term, shown in place of the
 * section page while a term is active. Best match first — the same row the
 * Enter key in the header search opens.
 */
@Component({
    selector: 'app-settings-search-results',
    imports: [MatIconModule, TranslatePipe],
    templateUrl: './settings-search-results.component.html',
    styleUrl: './settings-search-results.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSearchResultsComponent {
    readonly query = input.required<string>();
    readonly results = input.required<readonly SettingsSearchResult[]>();
    readonly selected = output<SettingsSearchEntry>();
}
