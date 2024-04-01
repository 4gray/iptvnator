import { NgIf } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { EpgProgram } from './../../../models/epg-program.model';

@Component({
    standalone: true,
    selector: 'app-epg-item-description',
    templateUrl: './epg-item-description.component.html',
    styleUrls: ['./epg-item-description.component.scss'],
    imports: [MatButtonModule, MatDialogModule, NgIf, TranslateModule],
})
export class EpgItemDescriptionComponent {
    /** EPG program object */
    epgProgram: EpgProgram;
    /**
     * Creates an instance of the component and injects the program of the clicked epg program
     * @param epgProgram epg program
     */
    constructor(@Inject(MAT_DIALOG_DATA) epgProgram: EpgProgram) {
        this.epgProgram = epgProgram;
    }
}
