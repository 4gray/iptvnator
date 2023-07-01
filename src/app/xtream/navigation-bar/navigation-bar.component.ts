import { NgFor } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ContentType } from '../content-type.enum';
import { Breadcrumb } from '../xtream-main-container.component';

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
    ],
})
export class NavigationBarComponent {
    @Input({ required: true }) breadcrumbs: Breadcrumb[];
    @Input({ required: true }) contentType: ContentType;

    @Output() contentTypeChanged = new EventEmitter<ContentType>();
    @Output() breadcrumbClicked = new EventEmitter<Breadcrumb>();

    ContentTypeEnum = ContentType;
}
