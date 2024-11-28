import { DatePipe } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
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
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatListModule,
        TranslateModule,
    ],
    styles: `
        mat-list {
            /* overflow-y: scroll; */
            height: 100vh;
        }
    `,
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
