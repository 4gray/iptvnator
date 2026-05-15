import {
    ChangeDetectorRef,
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
import { ChannelListItemComponent } from '@iptvnator/ui/components';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { StalkerVodSource } from '@iptvnator/portal/stalker/data-access';
import { normalizeStalkerEntityId } from '@iptvnator/portal/stalker/data-access';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';

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

    readonly playClicked = output<StalkerVodSource>();
    readonly favoriteToggled = output<StalkerVodSource>();

    private readonly stalkerStore = inject(StalkerStore);
    private readonly cdr = inject(ChangeDetectorRef);
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

    constructor() {
        effect(() => {
            const items = this.items();
            const bulkProgramsByChannel = this.stalkerStore.bulkItvEpgByChannel();
            this.syncBulkEpgPreviews(items, bulkProgramsByChannel);
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

    private syncBulkEpgPreviews(
        items: StalkerVodSource[],
        bulkProgramsByChannel: Record<string, EpgProgram[]>
    ): void {
        this.epgPrograms.clear();
        this.currentProgramsProgress.clear();

        if (items.length === 0 || Object.keys(bulkProgramsByChannel).length === 0) {
            this.cdr.markForCheck();
            return;
        }

        for (const item of items) {
            const channelId = normalizeStalkerEntityId(item.id);
            const currentProgram = this.findCurrentProgram(
                bulkProgramsByChannel[channelId] ?? []
            );

            if (!currentProgram) {
                continue;
            }

            this.epgPrograms.set(channelId, currentProgram);
            this.updateProgramProgress(channelId, currentProgram);
        }

        this.cdr.markForCheck();
    }

    private updateProgramProgress(
        channelId: string | number,
        program: EpgProgram
    ): void {
        const startMs = this.getProgramTimestampMs(
            program.start,
            program.startTimestamp
        );
        const stopMs = this.getProgramTimestampMs(
            program.stop,
            program.stopTimestamp
        );
        const nowMs = Date.now();

        if (
            Number.isFinite(startMs) &&
            Number.isFinite(stopMs) &&
            nowMs >= startMs &&
            nowMs <= stopMs &&
            stopMs > startMs
        ) {
            this.currentProgramsProgress.set(
                channelId,
                ((nowMs - startMs) / (stopMs - startMs)) * 100
            );
            return;
        }

        this.currentProgramsProgress.delete(channelId);
    }

    private findCurrentProgram(programs: EpgProgram[]): EpgProgram | null {
        const nowMs = Date.now();

        return (
            programs.find((program) => {
                const startMs = this.getProgramTimestampMs(
                    program.start,
                    program.startTimestamp
                );
                const stopMs = this.getProgramTimestampMs(
                    program.stop,
                    program.stopTimestamp
                );

                return nowMs >= startMs && nowMs <= stopMs;
            }) ?? null
        );
    }

    private getProgramTimestampMs(
        rawDate: string,
        timestamp?: number | null
    ): number {
        const parsedTimestamp = Number(timestamp);
        if (Number.isFinite(parsedTimestamp) && parsedTimestamp > 0) {
            return parsedTimestamp * 1000;
        }

        const parsedDate = Date.parse(rawDate);
        return Number.isFinite(parsedDate) ? parsedDate : Number.POSITIVE_INFINITY;
    }
}
