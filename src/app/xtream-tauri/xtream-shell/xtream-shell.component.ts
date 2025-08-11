import { Component, effect, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { TvNavigationDirective } from '../../shared/directives/tv-navigation.directive';
import * as PlaylistActions from '../../state/actions';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';
import { NavigationComponent } from '../navigation/navigation.component';
import { XtreamStore } from '../xtream.store';

@Component({
    templateUrl: './xtream-shell.component.html',
    styleUrls: ['./xtream-shell.component.scss'],
    imports: [
        LoadingOverlayComponent,
        NavigationComponent,
        RouterOutlet,
        TranslateModule,
        MatIcon,
        TvNavigationDirective,
    ],
    providers: [XtreamStore],
})
export class XtreamShellComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly xtreamStore = inject(XtreamStore);

    readonly getImportCount = this.xtreamStore.getImportCount;
    readonly isImporting = this.xtreamStore.isImporting;
    readonly itemsToImport = this.xtreamStore.itemsToImport;
    readonly portalStatus = this.xtreamStore.portalStatus;
    
    // Mobile navigation state
    readonly isMobileMenuOpen = signal(false);

    constructor() {
        effect(
            () => {
                if (this.xtreamStore.currentPlaylist() !== null) {
                    this.xtreamStore.initializeContent();
                }
            },
            { allowSignalWrites: true }
        );
    }

    ngOnInit() {
        this.xtreamStore.checkPortalStatus();
        this.store.dispatch(
            PlaylistActions.setActivePlaylist({
                playlistId: this.route.snapshot.params.id,
            })
        );
        
        // Handle window resize for responsive behavior
        this.handleWindowResize();
    }

    /**
     * Handle window resize events for responsive behavior
     */
    private handleWindowResize(): void {
        window.addEventListener('resize', () => {
            // Close mobile menu on large screens
            if (window.innerWidth > 768 && this.isMobileMenuOpen()) {
                this.closeMobileMenu();
            }
        });
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
     * Handle category click with mobile menu management
     */
    handleCategoryClick(category: 'vod' | 'live' | 'series') {
        this.xtreamStore.setSelectedContentType(category);
        this.router.navigate([category], {
            relativeTo: this.route,
        });
        
        // Close mobile menu after navigation
        if (this.isMobileMenuOpen()) {
            this.closeMobileMenu();
        }
    }

    /**
     * Handle page click with mobile menu management
     */
    handlePageClick(page: 'search' | 'recent' | 'favorites') {
        this.xtreamStore.setSelectedContentType(undefined);
        this.router.navigate([page], {
            relativeTo: this.route,
        });
        
        // Close mobile menu after navigation
        if (this.isMobileMenuOpen()) {
            this.closeMobileMenu();
        }
    }

    /**
     * Handle escape key to close mobile menu
     */
    onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape' && this.isMobileMenuOpen()) {
            this.closeMobileMenu();
        }
    }
}
