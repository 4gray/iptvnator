import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgProgram } from 'shared-interfaces';

@Component({
    selector: 'app-epg-item-description',
    templateUrl: './epg-item-description.component.html',
    styleUrls: ['./epg-item-description.component.scss'],
    imports: [MatButtonModule, MatDialogModule, TranslatePipe],
})
export class EpgItemDescriptionComponent {
    dialogData = inject<EpgProgram>(MAT_DIALOG_DATA);

    /** EPG program object */
    epgProgram: EpgProgram;

    /**
     * Creates an instance of the component and injects the program of the clicked epg program
     * @param epgProgram epg program
     */
    constructor() {
        this.epgProgram = this.dialogData;
    }
}
