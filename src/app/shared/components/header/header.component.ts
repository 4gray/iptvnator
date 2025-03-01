import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, Input, OnInit, effect } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { open } from '@tauri-apps/plugin-shell';
import { NgxWhatsNewModule } from 'ngx-whats-new';
import { HomeComponent } from '../../../home/home.component';
import { DataService } from '../../../services/data.service';
import { SortBy, SortOrder, SortService } from '../../../services/sort.service';
import { WhatsNewService } from '../../../services/whats-new.service';
import { setSelectedFilters } from '../../../state/actions';
import { selectActiveTypeFilters } from '../../../state/selectors';
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
        MatButtonModule,
        MatCheckboxModule,
        MatDividerModule,
        MatIconModule,
        MatMenuModule,
        MatToolbarModule,
        MatTooltipModule,
        NgIf,
        NgFor,
        FormsModule,
        NgxWhatsNewModule,
        ReactiveFormsModule,
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

    /** Environment flag for Tauri */
    isTauri = this.dataService.getAppEnvironment() === 'tauri';

    /** Visibility flag of the "what is new" modal dialog */
    isDialogVisible$ = this.whatsNewService.dialogState$;

    /** Dialog options */
    options = this.whatsNewService.options;

    /** Modals to show for the updated version of the application */
    modals = this.whatsNewService.getLatestChanges();

    isHome = true;

    playlistTypes = [
        {
            title: 'M3U (local, url, text)',
            id: 'm3u',
            checked: true,
        },
        {
            title: 'Xtream',
            id: 'xtream',
            checked: true,
        },
        {
            title: 'Stalker',
            id: 'stalker',
            checked: true,
        },
    ];

    selectedTypeFilters = this.store.selectSignal(selectActiveTypeFilters);

    SortBy = SortBy;
    SortOrder = SortOrder;
    currentSortOptions: { by: SortBy; order: SortOrder };

    constructor(
        private activatedRoute: ActivatedRoute,
        private dialog: MatDialog,
        private dataService: DataService,
        private router: Router,
        private store: Store,
        private whatsNewService: WhatsNewService,
        private sortService: SortService
    ) {
        effect(() => {
            if (this.selectedTypeFilters) {
                this.playlistTypes = this.playlistTypes.map((type) => {
                    type.checked = this.selectedTypeFilters().includes(type.id);
                    return type;
                });
            }
        });

        this.sortService.getSortOptions().subscribe((options) => {
            this.currentSortOptions = options;
        });
    }

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
    async openUrl(url: string): Promise<void> {
        if (this.isTauri) {
            await open(url);
        } else {
            window.open(url, '_blank');
        }
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

    onPlaylistFilterChange() {
        this.store.dispatch(
            setSelectedFilters({
                selectedFilters: this.playlistTypes
                    .filter((f) => f.checked)
                    .map((f) => f.id),
            })
        );
    }

    setSortOptions(by: SortBy, order: SortOrder): void {
        this.sortService.setSortOptions({ by, order });
    }

    isSortActive(by: SortBy, order: SortOrder): boolean {
        return (
            this.currentSortOptions?.by === by &&
            this.currentSortOptions?.order === order
        );
    }
}
