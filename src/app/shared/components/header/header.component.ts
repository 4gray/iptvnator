import { Component, Input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { DataService } from '../../../services/data.service';
import { WhatsNewService } from '../../../services/whats-new.service';
import { AboutDialogComponent } from '../about-dialog/about-dialog.component';

@Component({
    selector: 'app-header',
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.scss'],
})
export class HeaderComponent {
    /** Title of the header */
    @Input() title: string;

    /** Subtitle of the header */
    @Input() subtitle: string;

    /** Environment flag */
    isElectron = this.dataService.isElectron;

    /** Visibility flag of the "what is new" modal dialog */
    isDialogVisible$ = this.whatsNewService.dialogState$;

    /** Dialog options */
    options = this.whatsNewService.options;

    /** Modals to show for the updated version of the application */
    modals = this.whatsNewService.getLatestChanges();

    /** Creates an instance of SettingsComponent and injects angulars router module
     * @param router angulars router
     * @param dataService
     * @param whatsNewService
     */
    constructor(
        private router: Router,
        private dataService: DataService,
        private whatsNewService: WhatsNewService,
        private dialog: MatDialog
    ) {}

    /**
     * Navigates to the settings page
     */
    openSettings(): void {
        this.router.navigate(['/settings']);
    }

    /**
     * Opens the provided URL string in new browser window
     * @param url url to open
     */
    openUrl(url: string): void {
        window.open(url, '_blank');
    }

    /**
     * Sets the visibility flag of the modal window
     * @param visible show/hide window flag
     */
    setDialogVisibility(visible: boolean): void {
        if (this.modals.length > 0) {
            this.whatsNewService.changeDialogVisibleState(visible);
        }
    }

    /**
     * Opens the about dialog with description and version of
     * the app
     */
    openAboutDialog(): void {
        this.dialog.open(AboutDialogComponent, {
            panelClass: 'about-dialog-overlay',
            width: '600px',
        });
    }
}
