import {
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    Injector,
    OnInit,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistSwitcherComponent, ResizableDirective } from 'components';
import { XtreamCategory } from 'shared-interfaces';
import { EpgViewComponent, WebPlayerViewComponent } from 'shared-portals';
import { SettingsStore } from '../../services/settings-store.service';
import {
    CategoryManagementDialogComponent,
    CategoryManagementDialogData,
} from '../category-management-dialog/category-management-dialog.component';
import {
    CategoryViewComponent,
} from '../category-view/category-view.component';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../stores/xtream.store';

type LiveChannelSortMode = 'server' | 'name-asc' | 'name-desc';
const LIVE_CHANNEL_SORT_STORAGE_KEY = 'xtream-live-channel-sort-mode';

@Component({
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss', '../sidebar.scss'],
    imports: [
        CategoryViewComponent,
        EpgViewComponent,
        FormsModule,
        MatFormFieldModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatListModule,
        MatMenuModule,
        MatTooltipModule,
        /* MpvPlayerBarComponent, */
        PlaylistSwitcherComponent,
        PortalChannelsListComponent,
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent implements OnInit {
    private readonly favoritesService = inject(FavoritesService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly settingsStore = inject(SettingsStore);
    private readonly dialog = inject(MatDialog);
    private readonly route = inject(ActivatedRoute);

    readonly categories = this.xtreamStore.getCategoriesBySelectedType;
    readonly categoryItemCounts = this.xtreamStore.getCategoryItemCounts;
    readonly currentPlaylist = this.xtreamStore.currentPlaylist;
    readonly epgItems = this.xtreamStore.epgItems;
    readonly selectedCategoryId = this.xtreamStore.selectedCategoryId;
    readonly liveChannelSortMode = signal<LiveChannelSortMode>('server');
    readonly liveChannelSortLabel = computed(() => {
        const mode = this.liveChannelSortMode();
        if (mode === 'name-asc') return 'Name A-Z';
        if (mode === 'name-desc') return 'Name Z-A';
        return 'Server Order';
    });

    readonly selectedCategoryInfo = computed(() => {
        const categoryId = this.selectedCategoryId();
        if (!categoryId) return null;

        const categories = this.categories();
        const category = categories?.find(
            (c: any) => (c.category_id ?? c.id) === categoryId
        );
        const count = this.categoryItemCounts()?.get(categoryId) ?? 0;

        return {
            name: category?.category_name ?? category?.name ?? 'Channels',
            count,
        };
    });

    private readonly injector = inject(Injector);
    private readonly categoryView = viewChild(CategoryViewComponent, {
        read: ElementRef,
    });
    private categoryScrollTop = 0;

    readonly player = this.settingsStore.player;
    streamUrl: string;
    favorites = new Map<number, boolean>();

    ngOnInit() {
        const savedSortMode = localStorage.getItem(
            LIVE_CHANNEL_SORT_STORAGE_KEY
        );
        if (
            savedSortMode === 'server' ||
            savedSortMode === 'name-asc' ||
            savedSortMode === 'name-desc'
        ) {
            this.liveChannelSortMode.set(savedSortMode);
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    // Map using content.id instead of xtream_id
                    favorites.forEach((fav: any) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                });
        }

        const categoryId = this.route.firstChild?.snapshot.params['categoryId'];
        if (categoryId)
            this.xtreamStore.setSelectedCategory(Number(categoryId));
    }

    playLive(item: any) {
        const streamUrl = this.xtreamStore.constructStreamUrl(item);
        this.streamUrl = streamUrl;
        const isEmbeddedPlayer =
            this.player() === 'videojs' ||
            this.player() === 'html5' ||
            this.player() === 'artplayer';
        if (isEmbeddedPlayer) {
            return;
        }
        this.xtreamStore.openPlayer(streamUrl, item.title, item.poster_url);
    }

    selectCategory(category: XtreamCategory) {
        const el = this.categoryView()?.nativeElement;
        if (el) {
            this.categoryScrollTop = el.scrollTop;
        }
        const categoryId = (category as any).category_id ?? category.id;
        this.xtreamStore.setSelectedCategory(categoryId);
    }

    backToCategories() {
        this.xtreamStore.setSelectedCategory(null);
        afterNextRender(
            () => {
                const el = this.categoryView()?.nativeElement;
                if (el) {
                    el.scrollTop = this.categoryScrollTop;
                }
            },
            { injector: this.injector }
        );
    }

    openCategoryManagement(): void {
        const playlistId = this.route.parent?.snapshot.params['id'];
        const contentType = this.xtreamStore.selectedContentType();

        const dialogRef = this.dialog.open<
            CategoryManagementDialogComponent,
            CategoryManagementDialogData,
            boolean
        >(CategoryManagementDialogComponent, {
            data: {
                playlistId,
                contentType,
                itemCounts: this.categoryItemCounts(),
            },
            width: '500px',
            maxHeight: '80vh',
        });

        dialogRef.afterClosed().subscribe((result) => {
            if (result) {
                this.xtreamStore.reloadCategories();
            }
        });
    }

    setLiveChannelSortMode(mode: LiveChannelSortMode): void {
        this.liveChannelSortMode.set(mode);
        localStorage.setItem(LIVE_CHANNEL_SORT_STORAGE_KEY, mode);
    }
}
