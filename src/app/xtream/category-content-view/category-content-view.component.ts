import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { XtreamItem } from '../../../../shared/xtream-item.interface';
import { FilterPipe } from '../../shared/pipes/filter.pipe';
import { PortalStore } from '../portal.store';

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    standalone: true,
    imports: [
        NgFor,
        MatCardModule,
        MatIconModule,
        NgIf,
        FilterPipe,
        FormsModule,
    ],
})
export class CategoryContentViewComponent {
    @Input({ required: true }) items: XtreamItem[];
    @Output() itemClicked = new EventEmitter<any>();

    portalStore = inject(PortalStore);

    searchPhrase = this.portalStore.searchPhrase;

    trackByFn(_index: number, item: XtreamItem) {
        return item.stream_id;
    }
}
