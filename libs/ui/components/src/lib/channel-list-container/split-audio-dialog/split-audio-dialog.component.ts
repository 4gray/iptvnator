import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import {
    resolveExternalPlayerHttpHeaders,
    selectActivePlaylist,
} from '@iptvnator/m3u-state';
import {
    DataService,
    SPLIT_AUDIO_MAX_DELAY_SECONDS,
    SplitAudioService,
} from '@iptvnator/services';
import { Channel, OPEN_MPV_PLAYER } from '@iptvnator/shared/interfaces';
import { dialogSize } from '../../dialog-shell/dialog-size';

export interface SplitAudioDialogData {
    /** The channel whose picture is shown. */
    readonly video: Channel;
    /** Every channel the audio can come from. */
    readonly channels: readonly Channel[];
}

/** More rows than this are never useful to scroll; the search narrows the rest. */
const MAX_VISIBLE_CHANNELS = 300;

/**
 * "Video from this channel, audio from another one": picks the audio channel
 * and the delay between the two streams, then starts the video channel in
 * MPV with the other stream's audio attached.
 */
@Component({
    selector: 'app-split-audio-dialog',
    templateUrl: './split-audio-dialog.component.html',
    styleUrl: './split-audio-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatDialogModule, TranslatePipe],
})
export class SplitAudioDialogComponent {
    protected readonly data = inject<SplitAudioDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject(
        MatDialogRef<SplitAudioDialogComponent>
    );
    private readonly store = inject(Store);
    private readonly splitAudio = inject(SplitAudioService);
    private readonly dataService = inject(DataService);

    protected readonly maxDelay = SPLIT_AUDIO_MAX_DELAY_SECONDS;
    protected readonly query = signal('');
    protected readonly selected = signal<Channel | null>(null);
    protected readonly delay = signal(0);

    protected readonly visibleChannels = computed(() => {
        const needle = this.query().trim().toLowerCase();
        const videoUrl = this.data.video.url;
        return this.data.channels
            .filter(
                (channel) =>
                    channel.url !== videoUrl &&
                    (!needle ||
                        (channel.name ?? '').toLowerCase().includes(needle))
            )
            .slice(0, MAX_VISIBLE_CHANNELS);
    });

    /** Opens the dialog with the size every entry point shares. */
    static open(
        dialog: MatDialog,
        data: SplitAudioDialogData
    ): MatDialogRef<SplitAudioDialogComponent> {
        return dialog.open(SplitAudioDialogComponent, {
            ...dialogSize('md'),
            data,
        });
    }

    protected onQuery(event: Event): void {
        this.query.set((event.target as HTMLInputElement).value);
    }

    protected select(channel: Channel): void {
        this.selected.set(channel);
        // Back to the delay that worked last time for this exact pair.
        this.delay.set(
            this.splitAudio.savedDelay(this.data.video.url, channel.url)
        );
    }

    protected onDelay(event: Event): void {
        const value = Number((event.target as HTMLInputElement).value);
        this.delay.set(this.splitAudio.clampDelay(value));
    }

    /**
     * Always plays in an external MPV window, whatever player is selected in
     * the settings: only MPV can combine two streams.
     */
    protected async play(): Promise<void> {
        const audio = this.selected();
        if (!audio) {
            return;
        }
        const video = this.data.video;
        const delay = this.splitAudio.clampDelay(this.delay());
        this.splitAudio.saveDelay(video.url, audio.url, delay);
        const playlist = await firstValueFrom(
            this.store.select(selectActivePlaylist)
        );
        this.dialogRef.close();
        await this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
            url: video.url,
            title: video.name,
            ...resolveExternalPlayerHttpHeaders(video, playlist),
            audioUrl: audio.url,
            audioDelaySeconds: delay,
        });
    }
}
