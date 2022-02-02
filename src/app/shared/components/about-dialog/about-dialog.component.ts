import { Component } from '@angular/core';
import { DataService } from '../../../services/data.service';

@Component({
    selector: 'app-about-dialog',
    templateUrl: './about-dialog.component.html',
    styleUrls: ['./about-dialog.component.scss'],
})
export class AboutDialogComponent {
    /** Version of the application */
    appVersion = this.dataService.getAppVersion();

    /** Default constructor */
    constructor(private dataService: DataService) {}
}
