import { DatePipe } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { TranslateModule } from '@ngx-translate/core';
import { EpgItemDescriptionComponent } from '../../player/components/epg-list/epg-item-description/epg-item-description.component';
import { EpgItem } from '../../xtream/epg-item.interface';

@Component({
    standalone: true,
    selector: 'app-epg-view',
    templateUrl: './epg-view.component.html',
    imports: [DatePipe, MatIconButton, MatIcon, MatListModule, TranslateModule],
    styleUrls: ['./epg-view.component.scss'],
})
export class EpgViewComponent {
    @Input() epgItems: EpgItem[];

    dialog = inject(MatDialog);

    isCurrentProgram(item: EpgItem): boolean {
        const end = item.stop ?? item.end;
        const now = new Date().getTime();
        const start = new Date(item.start).getTime();
        const stop = new Date(end).getTime();
        return now >= start && now <= stop;
    }

    getProgress(item: EpgItem): number {
        const now = new Date().getTime();
        const start = new Date(item.start).getTime();
        const end = new Date(item.stop ?? item.end).getTime();

        const total = end - start;
        const current = now - start;

        return Math.min(Math.max((current / total) * 100, 0), 100);
    }

    showDetails(item: EpgItem) {
        this.dialog.open(EpgItemDescriptionComponent, {
            data: {
                title: item.title ?? 'No title',
                desc: item.description ?? 'No description',
            },
        });
    }
}
