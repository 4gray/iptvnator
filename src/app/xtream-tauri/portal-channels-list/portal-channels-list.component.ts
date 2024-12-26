import {
    CdkVirtualScrollViewport,
    ScrollingModule,
} from '@angular/cdk/scrolling';
import { DatePipe } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    inject,
    Output,
    signal,
    ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { XtreamItem } from '../../../../shared/xtream-item.interface';
import { DatabaseService } from '../../services/database.service';
import { FilterPipe } from '../../shared/pipes/filter.pipe';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../xtream.store';

interface EpgProgram {
    id: string;
    title: string;
    start: string;
    end: string;
    start_timestamp: string;
    stop_timestamp: string;
    // ...other properties
}

@Component({
    selector: 'app-portal-channels-list',
    standalone: true,
    templateUrl: './portal-channels-list.component.html',
    styleUrls: ['./portal-channels-list.component.scss'],
    imports: [
        DatePipe,
        FilterPipe,
        FormsModule,
        MatFormFieldModule,
        ScrollingModule,
        MatCardModule,
        MatIcon,
        MatIconButton,
        MatListModule,
        MatInputModule,
        TranslateModule,
        MatTooltipModule,
    ],
})
export class PortalChannelsListComponent implements AfterViewInit {
    @Output() playClicked = new EventEmitter<any>();

    readonly xtreamStore = inject(XtreamStore);
    private readonly favoritesService = inject(FavoritesService);
    private readonly dbService = inject(DatabaseService);
    private readonly route = inject(ActivatedRoute);
    readonly channels = this.xtreamStore.selectItemsFromSelectedCategory;

    favorites = new Map<number, boolean>();
    searchString = signal<string>('');
    currentPrograms = new Map<number, string>();
    currentProgramsProgress = new Map<number, number>();
    programTimings = new Map<number, { start: number; end: number }>(); // Changed to store timestamps
    private requestedChannels = new Set<number>();

    @ViewChild(CdkVirtualScrollViewport) viewport?: CdkVirtualScrollViewport;

    constructor(private cdr: ChangeDetectorRef) {}

    trackBy(_index: number, item: XtreamItem) {
        return item.xtream_id;
    }

    ngOnInit(): void {
        const { categoryId } = this.route.snapshot.params;
        if (categoryId)
            this.xtreamStore.setSelectedCategory(Number(categoryId));

        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    // Map using content.id instead of xtream_id
                    favorites.forEach((fav: any) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                    console.log(this.favorites);
                });
        }
        // Removed loadCurrentEpgData() call since we're using virtual scroll
    }

    ngAfterViewInit() {
        if (
            this.viewport &&
            this.xtreamStore.selectedContentType() === 'live'
        ) {
            this.viewport.renderedRangeStream.subscribe((range) => {
                const visibleChannels = this.channels().slice(
                    range.start,
                    range.end
                );
                this.loadEpgForVisibleChannels(visibleChannels);
            });
        }
    }

    private async loadEpgForVisibleChannels(channels: any[]): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) return;

        for (const channel of channels) {
            // Skip if we already requested or have EPG data for this channel
            if (
                this.requestedChannels.has(channel.xtream_id) ||
                this.currentPrograms.has(channel.xtream_id)
            ) {
                continue;
            }

            // Mark as requested before making the API call
            this.requestedChannels.add(channel.xtream_id);

            try {
                const epgData = await this.xtreamStore.loadChannelEpg(
                    channel.xtream_id
                );
                if (epgData && epgData.length > 0) {
                    this.currentPrograms.set(
                        channel.xtream_id,
                        epgData[0].title
                    );
                    this.updateProgramProgress(channel.xtream_id, epgData[0]);
                    this.cdr.detectChanges();
                }
            } catch (error) {
                console.error(
                    `Failed to load EPG for channel ${channel.xtream_id}:`,
                    error
                );
            }
        }
    }

    private updateProgramProgress(streamId: number, program: EpgProgram) {
        const now = new Date().getTime() / 1000;
        const start = parseInt(program.start_timestamp);
        const end = parseInt(program.stop_timestamp);

        if (now >= start && now <= end) {
            const duration = end - start;
            const elapsed = now - start;
            const progress = (elapsed / duration) * 100;

            this.currentProgramsProgress.set(streamId, progress);
            this.programTimings.set(streamId, {
                start: start * 1000, // Convert to milliseconds for date pipe
                end: end * 1000, // Convert to milliseconds for date pipe
            });
        }
    }

    isSelected(item: XtreamCategory): boolean {
        const selectedCategory = this.xtreamStore.selectedCategoryId();
        const itemId = Number((item as any).category_id || item.id);
        return selectedCategory !== null && selectedCategory === itemId;
    }

    async toggleFavorite(event: Event, item: any): Promise<void> {
        event.stopPropagation();
        const playlist = this.xtreamStore.currentPlaylist();

        // Update UI state immediately
        const currentFavoriteState =
            this.favorites.get(item.xtream_id) || false;
        this.favorites.set(item.xtream_id, !currentFavoriteState);

        try {
            const db = await this.dbService.getConnection();
            const content: any = await db.select(
                'SELECT id FROM content WHERE xtream_id = ?',
                [item.xtream_id]
            );

            if (!content || content.length === 0) {
                console.error('Content not found in database');
                // Revert UI state on error
                this.favorites.set(item.xtream_id, currentFavoriteState);
                return;
            }

            const contentId = content[0].id;

            if (!currentFavoriteState) {
                await this.favoritesService.addToFavorites({
                    content_id: contentId,
                    playlist_id: playlist.id,
                });
            } else {
                await this.favoritesService.removeFromFavorites(
                    contentId,
                    playlist.id
                );
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
            // Revert UI state on error
            this.favorites.set(item.xtream_id, currentFavoriteState);
        }
    }
}
