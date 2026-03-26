import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelListItemComponent } from 'components';
import { EpgProgram } from 'shared-interfaces';
import { UnifiedFavoriteChannel } from '@iptvnator/portal/shared/util';

export interface EnrichedUnifiedFavorite extends UnifiedFavoriteChannel {
    currentEpgProgram: EpgProgram | null;
    progressPercentage: number;
}

@Component({
    selector: 'app-global-favorites-list',
    templateUrl: './global-favorites-list.component.html',
    styleUrl: './global-favorites-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        DragDropModule,
        MatIconModule,
        TranslatePipe,
    ],
})
export class GlobalFavoritesListComponent {
    readonly channels = input.required<UnifiedFavoriteChannel[]>();
    readonly epgMap = input<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = input<number>(0);
    readonly activeUid = input<string | null>(null);
    readonly searchTermInput = input('');
    readonly draggable = input(true);

    readonly channelSelected = output<UnifiedFavoriteChannel>();
    readonly channelsReordered = output<UnifiedFavoriteChannel[]>();
    readonly favoriteToggled = output<UnifiedFavoriteChannel>();

    readonly hasSearchTerm = computed(
        () => this.searchTermInput().trim().length > 0
    );

    readonly enrichedChannels = computed((): EnrichedUnifiedFavorite[] => {
        const channels = this.channels();
        const epgMap = this.epgMap();
        const term = this.searchTermInput().trim().toLowerCase();
        this.progressTick();

        const filtered = term
            ? channels.filter((ch) => ch.name.toLowerCase().includes(term))
            : channels;

        return filtered.map((ch) => {
            const epgKey = ch.tvgId?.trim() || ch.name?.trim();
            const currentEpgProgram = epgKey
                ? (epgMap.get(epgKey) ?? null)
                : null;
            return {
                ...ch,
                currentEpgProgram,
                progressPercentage: this.calcProgress(currentEpgProgram),
            };
        });
    });

    onChannelClick(channel: UnifiedFavoriteChannel): void {
        this.channelSelected.emit(channel);
    }

    onFavoriteToggled(channel: UnifiedFavoriteChannel): void {
        this.favoriteToggled.emit(channel);
    }

    onDrop(event: CdkDragDrop<EnrichedUnifiedFavorite[]>): void {
        if (this.hasSearchTerm()) {
            return;
        }

        const list = [...this.channels()];
        moveItemInArray(list, event.previousIndex, event.currentIndex);
        this.channelsReordered.emit(list);
    }

    trackByUid(_: number, ch: EnrichedUnifiedFavorite): string {
        return ch.uid;
    }

    private calcProgress(program: EpgProgram | null | undefined): number {
        if (!program) {
            return 0;
        }

        const now = Date.now();
        const start = new Date(program.start).getTime();
        const stop = new Date(program.stop).getTime();
        const total = stop - start;
        const elapsed = now - start;
        return Math.min(100, Math.max(0, (elapsed / total) * 100));
    }
}
