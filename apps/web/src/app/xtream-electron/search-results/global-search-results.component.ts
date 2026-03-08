import { Component } from '@angular/core';
import { SearchResultsComponent } from './search-results.component';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';

@Component({
    selector: 'app-global-search-results',
    imports: [SearchResultsComponent],
    providers: [XtreamStore],
    template: '<app-search-results/>',
})
export class GlobalSearchResultsComponent {}
