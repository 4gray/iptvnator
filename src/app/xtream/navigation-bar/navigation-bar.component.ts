import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Breadcrumb } from '../breadcrumb.interface';
import { ContentType } from '../content-type.enum';
import { PortalStore } from '../portal.store';

@Component({
    selector: 'app-navigation-bar',
    templateUrl: './navigation-bar.component.html',
    styleUrls: ['./navigation-bar.component.scss'],
    standalone: true,
    imports: [
        MatButtonToggleModule,
        MatIconModule,
        MatButtonModule,
        RouterLink,
        NgFor,
        FormsModule,
        NgIf,
    ],
})
export class NavigationBarComponent {
    @Input({ required: true }) breadcrumbs: Breadcrumb[];
    @Input({ required: true }) contentType: ContentType;
    @Input() searchVisible = true;

    @Output() contentTypeChanged = new EventEmitter<ContentType>();
    @Output() breadcrumbClicked = new EventEmitter<Breadcrumb>();

    ContentTypeEnum = ContentType;
    portalStore = inject(PortalStore);
    searchPhrase = this.portalStore.searchPhrase;

    processBreadcrumbClick(item: Breadcrumb) {
        this.setSearchText('');
        this.breadcrumbClicked.emit(item);
    }

    setSearchText(text: string) {
        this.portalStore.setSearchPhrase(text);
    }
}
