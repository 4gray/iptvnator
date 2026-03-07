import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelListItemComponent } from 'components';
import { EpgItem, EpgProgram } from 'shared-interfaces';
import { StalkerVodSource } from '../models';
import { normalizeStalkerEntityId } from '../stalker-vod.utils';
import { StalkerStore } from '../stalker.store';

@Component({
    selector: 'app-stalker-collection-channels-list',
    imports: [ChannelListItemComponent, FormsModule, MatIconModule, TranslatePipe],
    templateUrl: './stalker-collection-channels-list.component.html',
    styleUrl: './stalker-collection-channels-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerCollectionChannelsListComponent {
    readonly items = input<StalkerVodSource[]>([]);
    readonly selectedItemId = input<string | number | null>(null);
    readonly favoriteIds = input<Map<string | number, boolean>>(new Map());

    readonly playClicked = output<any>();
    readonly favoriteToggled = output<any>();

    private readonly stalkerStore = inject(StalkerStore);
    protected readonly normalizeStalkerEntityId = normalizeStalkerEntityId;
    readonly searchString = signal('');
    readonly filteredItems = computed(() => {
        const search = this.searchString().trim().toLowerCase();
        if (!search) {
            return this.items();
        }

        return this.items().filter((item) =>
            `${item.o_name ?? ''} ${item.name ?? ''}`
                .toLowerCase()
                .includes(search)
        );
    });

    readonly epgPrograms = new Map<string | number, EpgProgram>();
    readonly currentProgramsProgress = new Map<string | number, number>();
    private readonly requestedChannels = new Set<string | number>();

    constructor() {
        effect(() => {
            const items = this.items();
            if (!items.length) {
                this.epgPrograms.clear();
                this.currentProgramsProgress.clear();
                this.requestedChannels.clear();
                return;
            }

            void this.loadEpgPreviews(items);
        });
    }

    onPlay(item: StalkerVodSource): void {
        this.playClicked.emit(item);
    }

    onFavoriteToggle(item: StalkerVodSource): void {
        this.favoriteToggled.emit(item);
    }

    isSelected(item: StalkerVodSource): boolean {
        return String(this.selectedItemId() ?? '') === normalizeStalkerEntityId(item.id);
    }

    isFavorite(item: StalkerVodSource): boolean {
        return this.favoriteIds().get(normalizeStalkerEntityId(item.id)) ?? false;
    }

    private async loadEpgPreviews(items: StalkerVodSource[]): Promise<void> {
        const newItems = items.filter((item) => {
            const id = normalizeStalkerEntityId(item.id);
            return id && !this.requestedChannels.has(id);
        });

        if (!newItems.length) {
            return;
        }

        for (const item of newItems) {
            this.requestedChannels.add(normalizeStalkerEntityId(item.id));
        }

        const batchSize = 3;
        for (let i = 0; i < newItems.length; i += batchSize) {
            const batch = newItems.slice(i, i + batchSize);
            await Promise.all(
                batch.map((item) => this.loadSingleEpgPreview(item.id))
            );
            if (i + batchSize < newItems.length) {
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
        }
    }

    private async loadSingleEpgPreview(channelId: number | string): Promise<void> {
        try {
            const items = await this.stalkerStore.fetchChannelEpg(channelId, 1);
            if (!items.length) {
                return;
            }

            const id = normalizeStalkerEntityId(channelId);
            const program = this.toPreviewProgram(items[0], id);
            this.epgPrograms.set(id, program);
            this.updateProgramProgress(id, items[0]);
        } catch {
            // Ignore preview failures for collection live lists.
        }
    }

    private updateProgramProgress(
        channelId: string | number,
        item: EpgItem
    ): void {
        const now = Date.now() / 1000;
        const start = parseInt(item.start_timestamp, 10);
        const end = parseInt(item.stop_timestamp, 10);

        if (start && end && now >= start && now <= end) {
            this.currentProgramsProgress.set(
                channelId,
                ((now - start) / (end - start)) * 100
            );
            return;
        }

        this.currentProgramsProgress.delete(channelId);
    }

    private toPreviewProgram(
        item: EpgItem,
        channelId: string | number
    ): EpgProgram {
        return {
            start: item.start,
            stop: item.stop || item.end,
            channel: String(channelId),
            title: item.title,
            desc: item.description || null,
            category: null,
        };
    }
}
