import {
    ChangeDetectionStrategy,
    Component,
    effect,
    HostListener,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { EpgViewComponent } from '../../portals/epg-view/epg-view.component';
import { WebPlayerViewComponent } from '../../portals/web-player-view/web-player-view.component';
import { SettingsStore } from '../../services/settings-store.service';
import { CategoryViewComponent } from '../category-view/category-view.component';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../xtream.store';

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
        PortalChannelsListComponent,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent implements OnInit {
    private readonly favoritesService = inject(FavoritesService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly settingsStore = inject(SettingsStore);

    readonly categories = this.xtreamStore.getCategoriesBySelectedType;
    readonly epgItems = this.xtreamStore.epgItems;
    readonly selectedCategoryId = this.xtreamStore.selectedCategoryId;
    private readonly route = inject(ActivatedRoute);

    readonly player = this.settingsStore.player;
    streamUrl: string;
    favorites = new Map<number, boolean>();

    // Responsive layout state
    readonly isMobileLayout = signal(false);
    readonly isMobileMenuOpen = signal(false);
    readonly isSidebarCollapsed = signal(false);
    readonly isVideoPopout = signal(false);
    readonly isEpgVisible = signal(true);

    constructor() {
        // Listen for window resize to update layout
        effect(() => {
            this.updateLayout();
        });
    }

    ngOnInit() {
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

        const { categoryId } = this.route.firstChild.snapshot.params;
        if (categoryId)
            this.xtreamStore.setSelectedCategory(Number(categoryId));

        // Initial layout update
        this.updateLayout();
    }

    /**
     * Update layout based on screen size and orientation
     */
    private updateLayout(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const isPortrait = height > width;
        
        // Determine if we should use mobile layout
        const shouldUseMobileLayout = width <= 768 || (isPortrait && width <= 1024);
        this.isMobileLayout.set(shouldUseMobileLayout);
        
        // Auto-close mobile menu on large screens
        if (!shouldUseMobileLayout && this.isMobileMenuOpen()) {
            this.closeMobileMenu();
        }
    }

    /**
     * Toggle mobile navigation menu
     */
    toggleMobileMenu(): void {
        this.isMobileMenuOpen.update(open => !open);
        
        // Prevent body scroll when menu is open
        if (this.isMobileMenuOpen()) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }

    /**
     * Close mobile navigation menu
     */
    closeMobileMenu(): void {
        this.isMobileMenuOpen.set(false);
        document.body.style.overflow = '';
    }

    /**
     * Toggle sidebar collapse (desktop only)
     */
    toggleSidebar(): void {
        this.isSidebarCollapsed.update(collapsed => !collapsed);
    }

    /**
     * Toggle video popout window
     */
    toggleVideoPopout(): void {
        this.isVideoPopout.update(popout => !popout);
    }

    /**
     * Close video popout window
     */
    closeVideoPopout(): void {
        this.isVideoPopout.set(false);
    }

    /**
     * Toggle EPG visibility
     */
    toggleEpg(): void {
        this.isEpgVisible.update(visible => !visible);
    }

    /**
     * Toggle fullscreen mode
     */
    toggleFullscreen(): void {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Handle escape key to close mobile menu and popout
     */
    @HostListener('document:keydown', ['$event'])
    onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            if (this.isVideoPopout()) {
                this.closeVideoPopout();
            } else if (this.isMobileMenuOpen()) {
                this.closeMobileMenu();
            }
        }
    }

    /**
     * Handle window resize for responsive behavior
     */
    @HostListener('window:resize')
    onResize(): void {
        this.updateLayout();
    }

    playLive(item: any) {
        const streamUrl = this.xtreamStore.constructStreamUrl(item);
        this.streamUrl = streamUrl;
        this.xtreamStore.openPlayer(streamUrl, item.title, item.poster_url);
        
        // Close mobile menu after playing
        if (this.isMobileMenuOpen()) {
            this.closeMobileMenu();
        }
    }

    selectCategory(category: XtreamCategory) {
        const categoryId = (category as any).category_id ?? category.id;
        this.xtreamStore.setSelectedCategory(categoryId);
        
        // Close mobile menu after category selection
        if (this.isMobileMenuOpen()) {
            this.closeMobileMenu();
        }
    }

    backToCategories() {
        this.xtreamStore.setSelectedCategory(null);
    }
}
