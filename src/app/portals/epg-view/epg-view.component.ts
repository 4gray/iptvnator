import { DatePipe } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { TranslateModule } from '@ngx-translate/core';
import { EpgItemDescriptionComponent } from '../../player/components/epg-list/epg-item-description/epg-item-description.component';
import { EpgItem } from '../../xtream/epg-item.interface';

@Component({
    standalone: true,
    selector: 'app-epg-view',
    templateUrl: './epg-view.component.html',
    imports: [
        DatePipe,
        MatIconButton,
        MatDivider,
        MatIcon,
        MatListModule,
        TranslateModule,
    ],
    styles: [
        `
            .epg-title {
                margin: 0;
                font-size: 1.2rem;
                font-weight: 500;
                padding: 16px;
            }
        `,
    ],
})
export class EpgViewComponent {
    @Input() epgItems: EpgItem[];

    dialog = inject(MatDialog);

    showDetails(item: EpgItem) {
        this.dialog.open(EpgItemDescriptionComponent, {
            data: {
                title: item.title ?? 'No title',
                desc: item.description ?? 'No description',
            },
        });
    }
}
