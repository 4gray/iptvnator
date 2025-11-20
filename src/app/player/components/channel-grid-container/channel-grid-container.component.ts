import {
    Component,
    ElementRef,
    HostListener,
    Input,
    ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import * as PlaylistActions from '../../../state/actions';
import { EpgService } from '../../../services/epg.service';
import { selectFavorites } from '../../../state/selectors';

@Component({
    selector: 'app-channel-grid-container',
    templateUrl: './channel-grid-container.component.html',
    styleUrls: ['./channel-grid-container.component.scss'],
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatTooltipModule,
        TranslateModule,
    ],
})
export class ChannelGridContainerComponent {
    private readonly destroy$ = new Subject<void>();
    private favoriteIds = new Set<string>();
    private _channelList: Channel[] = [];

    @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

    filteredChannels: Channel[] = [];
    searchTerm = '';
    selectedChannelId?: string;

    @Input()
    set channelList(value: Channel[] | null | undefined) {
        this._channelList = value ?? [];
        this.applyFilter();
    }
    get channelList(): Channel[] {
        return this._channelList;
    }

    constructor(
        private readonly epgService: EpgService,
        private readonly snackBar: MatSnackBar,
        private readonly store: Store,
        private readonly translateService: TranslateService
    ) {
        this.store
            .select(selectFavorites)
            .pipe(takeUntil(this.destroy$))
            .subscribe((favoriteUrls) => {
                this.favoriteIds = new Set(favoriteUrls ?? []);
            });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    applyFilter(): void {
        const term = this.searchTerm.trim().toLowerCase();
        this.filteredChannels = term
            ? this.channelList.filter((channel) =>
                  channel?.name?.toLowerCase().includes(term)
              )
            : [...this.channelList];
    }

    clearSearch(): void {
        if (!this.searchTerm) {
            return;
        }
        this.searchTerm = '';
        this.applyFilter();
        this.searchInput?.nativeElement.focus();
    }

    onSearchChange(term: string): void {
        this.searchTerm = term;
        this.applyFilter();
    }

    selectChannel(channel: Channel): void {
        if (!channel) {
            return;
        }
        this.selectedChannelId = channel.id;
        this.store.dispatch(PlaylistActions.setActiveChannel({ channel }));
        const epgChannelId = channel?.name?.trim();
        if (epgChannelId) {
            this.epgService.getChannelPrograms(epgChannelId);
        }
    }

    onCardKeyDown(event: KeyboardEvent, channel: Channel): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.selectChannel(channel);
        }
    }

    toggleFavorite(channel: Channel, event: MouseEvent): void {
        event.stopPropagation();
        this.store.dispatch(PlaylistActions.updateFavorites({ channel }));
        this.snackBar.open(
            this.translateService.instant('CHANNELS.FAVORITES_UPDATED'),
            undefined,
            { duration: 2000 }
        );
    }

    isFavorite(channel: Channel): boolean {
        return this.favoriteIds.has(channel?.url);
    }

    trackByFn(index: number, channel: Channel): string {
        return channel?.id ?? channel?.url ?? String(index);
    }

    @HostListener('document:keydown', ['$event'])
    handleHotkeys(event: KeyboardEvent): void {
        if (event.ctrlKey && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            this.searchInput?.nativeElement.focus();
        }
    }
}


