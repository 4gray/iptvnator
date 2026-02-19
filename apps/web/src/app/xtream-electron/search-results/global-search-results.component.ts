import { Component } from '@angular/core';
import { SearchResultsComponent } from './search-results.component';
import { XtreamStore } from '../stores/xtream.store';

@Component({
    selector: 'app-global-search-results',
    imports: [SearchResultsComponent],
    providers: [XtreamStore],
    template: '<app-search-results/>'
})
export class GlobalSearchResultsComponent {}
