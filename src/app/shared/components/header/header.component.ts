import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NgxWhatsNewModule } from 'ngx-whats-new';
import { HomeComponent } from '../../../home/home.component';
import { DataService } from '../../../services/data.service';
import { WhatsNewService } from '../../../services/whats-new.service';
import { AboutDialogComponent } from '../about-dialog/about-dialog.component';
import {
    AddPlaylistDialogComponent,
    PlaylistType,
} from '../add-playlist/add-playlist-dialog.component';

@Component({
    standalone: true,
    selector: 'app-header',
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.scss'],
    imports: [
        AsyncPipe,
        NgIf,
        NgFor,
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatDividerModule,
        MatTooltipModule,
        NgxWhatsNewModule,
        TranslateModule,
    ],
})
export class HeaderComponent implements OnInit {
    /** Title of the header */
    @Input() title!: string;

    /** Subtitle of the header */
    @Input() subtitle!: string;

    /** Environment flag */
    isElectron = this.dataService.isElectron;

    /** Visibility flag of the "what is new" modal dialog */
    isDialogVisible$ = this.whatsNewService.dialogState$;

    /** Dialog options */
    options = this.whatsNewService.options;

    /** Modals to show for the updated version of the application */
    modals = this.whatsNewService.getLatestChanges();

    isHome = true;

    /** Creates an instance of HeaderComponent */
    constructor(
        private activatedRoute: ActivatedRoute,
        private dialog: MatDialog,
        private dataService: DataService,
        private router: Router,
        private whatsNewService: WhatsNewService
    ) {}

    ngOnInit() {
        this.isHome =
            this.activatedRoute.snapshot.component.name === HomeComponent.name;
    }

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
            data: this.dataService.getAppVersion(),
        });
    }

    opedAddPlaylistDialog(type: PlaylistType) {
        this.dialog.open<AddPlaylistDialogComponent, { type: PlaylistType }>(
            AddPlaylistDialogComponent,
            {
                width: '600px',
                data: { type },
            }
        );
    }
}
