import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FilterPipe, SortPipe } from '@iptvnator/pipes';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamItem } from 'shared-interfaces';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';
import { PortalStore } from '../portal.store';

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    imports: [
        FilterPipe,
        SortPipe,
        MatCardModule,
        MatIconModule,
        MatTooltipModule,
        PlaylistErrorViewComponent,
        TranslateModule,
    ],
})
export class CategoryContentViewComponent {
    @Input({ required: true }) items: XtreamItem[];
    @Output() itemClicked = new EventEmitter<XtreamItem>();

    portalStore = inject(PortalStore);
    searchPhrase = this.portalStore.searchPhrase;
    sortType = this.portalStore.sortType;
}
