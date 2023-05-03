import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { EpgProgram } from './../../../models/epg-program.model';

@Component({
    selector: 'app-epg-item-description',
    templateUrl: './epg-item-description.component.html',
    styleUrls: ['./epg-item-description.component.scss'],
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
