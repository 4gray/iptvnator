import { Component } from '@angular/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RecentlyViewedComponent } from '../recently-viewed/recently-viewed.component';

@Component({
    selector: 'app-global-recently-viewed',
    imports: [RecentlyViewedComponent],
    providers: [XtreamStore],
    template: '<app-recently-viewed/>',
})
export class GlobalRecentlyViewedComponent {}
