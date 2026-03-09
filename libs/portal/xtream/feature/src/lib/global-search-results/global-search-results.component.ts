import { Component } from '@angular/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { SearchResultsComponent } from '../search-results/search-results.component';

@Component({
    selector: 'app-global-search-results',
    imports: [SearchResultsComponent],
    providers: [XtreamStore],
    template: '<app-search-results/>',
})
export class GlobalSearchResultsComponent {}
