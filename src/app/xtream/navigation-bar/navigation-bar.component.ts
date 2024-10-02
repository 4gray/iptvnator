import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { PlaylistInfoComponent } from '../../home/recent-playlists/playlist-info/playlist-info.component';
import { selectCurrentPlaylist } from '../../state/selectors';
import { Breadcrumb } from '../breadcrumb.interface';
import { ContentTypeNavigationItem } from '../content-type-navigation-item.interface';
import { ContentType } from '../content-type.enum';
import { PortalStore } from '../portal.store';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
    selector: 'app-navigation-bar',
    templateUrl: './navigation-bar.component.html',
    styleUrls: ['./navigation-bar.component.scss'],
    standalone: true,
    imports: [
        FormsModule,
        MatButtonModule,
        MatButtonToggleModule,
        MatIconModule,
        MatInputModule,
        MatFormFieldModule,
        NgFor,
        NgIf,
        RouterLink,
        TranslateModule,
        MatMenuModule,
        MatCheckboxModule,
        MatTooltipModule
    ],
})
export class NavigationBarComponent {
    @Input({ required: true }) breadcrumbs: Breadcrumb[];
    @Input({ required: true }) contentType: ContentType;
    @Input() searchVisible = true;
    @Input() sortVisible = false;
    @Input() contentTypeNavigationItems: ContentTypeNavigationItem[];
    @Input() clientSideSearch = true;
    @Input() showCategories = false;

    @Output() contentTypeChanged = new EventEmitter<ContentType>();
    @Output() breadcrumbClicked = new EventEmitter<Breadcrumb>();
    @Output() favoritesClicked = new EventEmitter<void>();
    @Output() searchTextChanged = new EventEmitter<string>();

    ContentTypeEnum = ContentType;
    dialog = inject(MatDialog);
    portalStore = inject(PortalStore);
    store = inject(Store);
    searchPhrase = this.portalStore.searchPhrase;
    searchPhraseUpdate = new Subject<string>();
    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);
    sortType = this.portalStore.sortType;

    constructor() {
        this.searchPhraseUpdate
            .pipe(debounceTime(600), distinctUntilChanged())
            .subscribe((value) => {
                this.setSearchText(value);
            });
    }

    openPlaylistDetails() {
        this.dialog.open(PlaylistInfoComponent, {
            data: this.currentPlaylist(),
        });
    }

    processBreadcrumbClick(item: Breadcrumb) {
        this.setSearchText('');
        this.breadcrumbClicked.emit(item);
    }

    setSortType(type: string) {
        this.portalStore.setSortType(type);
    }

    setSearchText(text: string) {
        if (this.clientSideSearch) this.portalStore.setSearchPhrase(text);
        else this.searchTextChanged.emit(text);
    }

    changeContentType(type: ContentType) {
        this.setSearchText('');
        this.contentTypeChanged.emit(type);
    }

    trackByValue(_i: number, value: ContentTypeNavigationItem) {
        return value.contentType;
    }
}
