import { ChangeDetectionStrategy } from '@angular/core';
import {
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import {
    MatButtonToggle,
    MatButtonToggleGroup,
} from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { StreamResolverService } from '@iptvnator/portal/shared/data-access';
import {
    buildLiveCollectionNavigationTarget,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import type { PlaybackDiagnostic } from '@iptvnator/ui/playback';
import {
    MultiviewChannelPickerDialogComponent,
    MultiviewChannelPickerResult,
} from './multiview-channel-picker-dialog.component';
import {
    MULTIVIEW_LAYOUT_PRESETS,
    MultiviewLayoutId,
} from './multiview-layouts';
import {
    MultiviewSlotChannel,
    MultiviewStateService,
} from './multiview-state.service';
import {
    MultiviewTileComponent,
    MultiviewTilePlayback,
    MultiviewTileStatus,
} from './multiview-tile.component';

interface MultiviewSlotResolution {
    readonly status: MultiviewTileStatus;
    readonly playback: MultiviewTilePlayback | null;
    readonly errorKey: string | null;
}

const RESOLVING: MultiviewSlotResolution = Object.freeze({
    status: 'resolving' as MultiviewTileStatus,
    playback: null,
    errorKey: null,
});

/**
 * Multiview grid page: watch several live TV channels at once in a
 * runtime-switchable layout. One tile has audio focus; double-clicking a
 * tile hands the channel over to the regular full player.
 */
@Component({
    selector: 'lib-multiview-page',
    templateUrl: './multiview-page.component.html',
    styleUrls: ['./multiview-page.component.scss'],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [MultiviewStateService],
    imports: [
        MatButtonToggle,
        MatButtonToggleGroup,
        MatIcon,
        MatIconButton,
        MatTooltip,
        MultiviewTileComponent,
        TranslatePipe,
    ],
})
export class MultiviewPageComponent {
    readonly state = inject(MultiviewStateService);
    private readonly streamResolver = inject(StreamResolverService);
    private readonly dialog = inject(MatDialog);
    private readonly router = inject(Router);

    readonly layouts = MULTIVIEW_LAYOUT_PRESETS;

    private readonly resolutions = signal<
        ReadonlyMap<string, MultiviewSlotResolution>
    >(new Map());
    private readonly requestIds = new Map<string, number>();
    private nextRequestId = 0;
    private destroyed = false;
    private pickerOpen = false;

    /** Portal accounts (`sourceType::playlistId`) used by 2+ slots. */
    private readonly conflictingAccountKeys = computed<readonly string[]>(
        () => {
            const counts = new Map<string, number>();
            for (const slot of this.state.slots()) {
                if (!slot) {
                    continue;
                }
                const { sourceType, playlistId } = slot.item;
                if (sourceType !== 'xtream' && sourceType !== 'stalker') {
                    continue;
                }
                const key = `${sourceType}::${playlistId}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            return [...counts.entries()]
                .filter(([, count]) => count > 1)
                .map(([key]) => key);
        }
    );
    private readonly dismissedConflictKeys = signal<ReadonlySet<string>>(
        new Set()
    );
    readonly connectionLimitHintVisible = computed(() => {
        // Dismissal is per account combination: a *new* same-account
        // conflict introduced after dismissing brings the hint back.
        const dismissed = this.dismissedConflictKeys();
        return this.conflictingAccountKeys().some((key) => !dismissed.has(key));
    });

    constructor() {
        effect(() => {
            const slots = this.state.slots();
            untracked(() => this.syncResolutions(slots));
        });
        inject(DestroyRef).onDestroy(() => {
            // Invalidate in-flight resolutions so late results are dropped
            // and no new portal sessions are requested after navigation.
            this.destroyed = true;
            this.requestIds.clear();
        });
    }

    resolutionFor(slot: MultiviewSlotChannel): MultiviewSlotResolution {
        return this.resolutions().get(slot.item.uid) ?? RESOLVING;
    }

    onLayoutChange(layoutId: MultiviewLayoutId): void {
        this.state.setLayout(layoutId);
    }

    dismissHint(): void {
        this.dismissedConflictKeys.set(new Set(this.conflictingAccountKeys()));
    }

    async openPicker(index: number): Promise<void> {
        if (this.pickerOpen) {
            // Guard against double-click opening two overlapping dialogs.
            return;
        }
        this.pickerOpen = true;
        try {
            const dialogRef = this.dialog.open<
                MultiviewChannelPickerDialogComponent,
                void,
                MultiviewChannelPickerResult
            >(MultiviewChannelPickerDialogComponent, { autoFocus: false });
            const result = await firstValueFrom(dialogRef.afterClosed());
            if (result) {
                this.state.assign(index, result);
            }
        } finally {
            this.pickerOpen = false;
        }
    }

    retry(slot: MultiviewSlotChannel): void {
        // Re-resolve instead of replaying the old URL — Stalker create_link
        // tokens and Xtream sessions may have expired in the meantime.
        void this.resolveItem(slot.item);
    }

    onTileFailed(
        slot: MultiviewSlotChannel,
        diagnostic: PlaybackDiagnostic
    ): void {
        console.warn(
            '[multiview] tile playback failed',
            slot.item.uid,
            diagnostic
        );
        this.updateResolution(slot.item.uid, {
            status: 'error',
            playback: null,
            errorKey: 'MULTIVIEW.TILE_ERROR',
        });
    }

    openInPlayer(slot: MultiviewSlotChannel): void {
        const item = slot.item;
        const itemId = item.uid.split('::')[2];
        if (!itemId) {
            // Malformed persisted uid — no reliable navigation target.
            return;
        }
        const target = buildLiveCollectionNavigationTarget({
            mode: slot.origin,
            sourceType: item.sourceType,
            playlistId: item.playlistId,
            itemId,
            title: item.name,
            imageUrl: item.logo,
        });
        void this.router.navigate(target.link, { state: target.state });
    }

    private syncResolutions(
        slots: readonly (MultiviewSlotChannel | null)[]
    ): void {
        const activeUids = new Set<string>();
        for (const slot of slots) {
            if (slot) {
                activeUids.add(slot.item.uid);
            }
        }

        const current = this.resolutions();
        const stale = [...current.keys()].filter((uid) => !activeUids.has(uid));
        if (stale.length > 0) {
            const next = new Map(current);
            for (const uid of stale) {
                next.delete(uid);
                this.requestIds.delete(uid);
            }
            this.resolutions.set(next);
        }

        for (const slot of slots) {
            if (slot && !this.resolutions().has(slot.item.uid)) {
                void this.resolveItem(slot.item);
            }
        }
    }

    private async resolveItem(item: UnifiedCollectionItem): Promise<void> {
        if (this.destroyed) {
            // Never open new portal sessions after navigation away.
            return;
        }
        // Monotonic across all slots so a removed-and-re-added channel can
        // never collide with a stale in-flight request id.
        const requestId = ++this.nextRequestId;
        this.requestIds.set(item.uid, requestId);
        this.updateResolution(item.uid, RESOLVING);

        try {
            const playback = await this.streamResolver.resolvePlayback(item);
            if (this.destroyed || this.requestIds.get(item.uid) !== requestId) {
                return;
            }
            if (!playback.streamUrl) {
                throw new Error('Empty stream URL');
            }
            this.updateResolution(item.uid, {
                status: 'ready',
                playback: {
                    url: playback.streamUrl,
                    title: playback.title ?? item.name,
                    logo: item.logo ?? playback.thumbnail ?? undefined,
                    userAgent: playback.userAgent,
                    referer: playback.referer,
                },
                errorKey: null,
            });
        } catch {
            if (this.destroyed || this.requestIds.get(item.uid) !== requestId) {
                return;
            }
            this.updateResolution(item.uid, {
                status: 'error',
                playback: null,
                errorKey: 'MULTIVIEW.TILE_ERROR',
            });
        }
    }

    private updateResolution(
        uid: string,
        resolution: MultiviewSlotResolution
    ): void {
        const next = new Map(this.resolutions());
        next.set(uid, resolution);
        this.resolutions.set(next);
    }
}
