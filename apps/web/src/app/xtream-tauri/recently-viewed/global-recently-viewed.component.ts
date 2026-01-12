import { Component } from '@angular/core';
import { RecentlyViewedComponent } from './recently-viewed.component';
import { XtreamStore } from '../stores/xtream.store';

@Component({
    selector: 'app-global-recently-viewed',
    imports: [RecentlyViewedComponent],
    providers: [XtreamStore],
    template: '<app-recently-viewed/>'
})
export class GlobalRecentlyViewedComponent {}
