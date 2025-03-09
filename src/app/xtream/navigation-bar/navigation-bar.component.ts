import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import {
    Component,
    EventEmitter,
    Input,
    OnChanges,
    Output,
    SimpleChanges,
    inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import {
    Observable,
    Subject,
    debounceTime,
    distinctUntilChanged,
    map,
} from 'rxjs';
import { XtreamLiveStream } from '../../../../shared/xtream-live-stream.interface';
import { PlaylistInfoComponent } from '../../home/recent-playlists/playlist-info/playlist-info.component';
import { SettingsComponent } from '../../settings/settings.component';
import { selectCurrentPlaylist } from '../../state/selectors';

import { SettingsStore } from '../../services/settings-store.service';
import { Breadcrumb } from '../breadcrumb.interface';
import { ContentTypeNavigationItem } from '../content-type-navigation-item.interface';
import { ContentType } from '../content-type.enum';
import { PortalStore } from '../portal.store';

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
        MatTooltipModule,
        AsyncPipe,
    ],
})
export class NavigationBarComponent implements OnChanges {
    @Input({ required: true }) breadcrumbs: Breadcrumb[];
    @Input({ required: true }) contentType: ContentType;
    @Input() searchVisible = true;
    @Input() sortVisible = false;
    @Input() contentTypeNavigationItems: ContentTypeNavigationItem[];
    @Input() clientSideSearch = true;
    @Input() showCategories = false;
    @Input() activeLiveStream!: XtreamLiveStream;
    @Input() favoritesLiveStream$: Observable<any>;
    @Input() favoriteVisible = false;

    @Output() contentTypeChanged = new EventEmitter<ContentType>();
    @Output() breadcrumbClicked = new EventEmitter<Breadcrumb>();
    @Output() favoritesClicked = new EventEmitter<void>();
    @Output() searchTextChanged = new EventEmitter<string>();
    @Output() addToFavoritesClicked = new EventEmitter<any>();
    @Output() removeFromFavoritesClicked = new EventEmitter<number>();

    ContentTypeEnum = ContentType;
    dialog = inject(MatDialog);
    portalStore = inject(PortalStore);
    store = inject(Store);
    searchPhrase = this.portalStore.searchPhrase;
    searchPhraseUpdate = new Subject<string>();
    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);
    sortType = this.portalStore.sortType;
    isFavoriteStream = false;
    settingsStore = inject(SettingsStore);

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

    clickFavorites(): void {
        const item = this.activeLiveStream;
        if (!this.isFavoriteStream) {
            this.addToFavoritesClicked.emit({
                name: item.name,
                stream_id: item.stream_id,
                cover: item.stream_icon,
                stream_type: 'live',
            });
            this.isFavoriteStream = true;
        } else {
            this.removeFromFavoritesClicked.emit(item.stream_id);
            this.isFavoriteStream = false;
        }
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes.activeLiveStream && this.activeLiveStream) {
            this.checkFavorite();
        }
    }

    checkFavorite() {
        // if activeLiveStream.stream_id include in favorites return the true
        const activeLiveStream = this.activeLiveStream;
        this.favoritesLiveStream$
            .pipe(
                map((favorites) =>
                    favorites.some(
                        (fav) => fav.stream_id === activeLiveStream.stream_id
                    )
                )
            )
            .subscribe((isFavorite) => {
                this.isFavoriteStream = isFavorite;
            });
    }

    openSettings(): void {
        this.dialog.open(SettingsComponent, {
            width: '1000px',
            height: '90%',
            data: { isDialog: true },
        });
    }
}
