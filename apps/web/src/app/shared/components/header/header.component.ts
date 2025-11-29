import { Component, HostBinding, OnInit, effect, inject, input, output } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DataService, SortBy, SortOrder, SortService } from 'services';
//import { shell } from 'electron';
import { selectActiveTypeFilters, setSelectedFilters } from 'm3u-state';
import { HomeComponent } from '../../../home/home.component';
import { AboutDialogComponent } from '../about-dialog/about-dialog.component';
import {
    AddPlaylistDialogComponent,
    PlaylistType,
} from '../add-playlist/add-playlist-dialog.component';

@Component({
    selector: 'app-header',
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.scss'],
    imports: [
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatDividerModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
})
export class HeaderComponent implements OnInit {
    @HostBinding('class.home-header') get isHomeHeader() {
        return this.isHome;
    }
    private activatedRoute = inject(ActivatedRoute);
    private dialog = inject(MatDialog);
    private dataService = inject(DataService);
    private router = inject(Router);
    private store = inject(Store);
    private sortService = inject(SortService);

    readonly isDesktop = !!window.electron;
    readonly title = input.required<string>();
    readonly subtitle = input.required<string>();
    readonly searchQuery = output<string>();

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

    private readonly selectedTypeFilters = this.store.selectSignal(
        selectActiveTypeFilters
    );

    readonly SortBy = SortBy;
    readonly SortOrder = SortOrder;
    private currentSortOptions: { by: SortBy; order: SortOrder };

    constructor() {
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
        if (this.isDesktop) {
            console.log('TODO: implement me');
            // await shell.openExternal(url);
        } else {
            window.open(url, '_blank');
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

    onSearchQueryUpdate(query: string): void {
        this.searchQuery.emit(query);
    }
}
