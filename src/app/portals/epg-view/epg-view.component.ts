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
        EpgItemDescriptionComponent,
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatListModule,
        TranslateModule,
    ],
    styles: `
        mat-list {
            overflow-y: scroll;
            height: calc(100vh - 459px);
        }
    `,
})
export class EpgViewComponent {
    @Input() epgItems: EpgItem[];

    dialog = inject(MatDialog);

    showDetails(item: EpgItem) {
        this.dialog.open(EpgItemDescriptionComponent, {
            data: {
                title: [{ value: item.title, lang: item.lang }],
                desc: [{ value: item.description }],
            },
        });
    }
}
