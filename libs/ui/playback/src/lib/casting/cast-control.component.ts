import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    computed,
    inject,
    input,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import {
    DlnaRendererDevice,
    hasPlaybackHeaders,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { findCastMediaElement, isDirectCastUrl } from './cast-media.utils';
import { CastService } from './cast.service';

@Component({
    selector: 'app-cast-control',
    templateUrl: './cast-control.component.html',
    styleUrl: './cast-control.component.scss',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        TranslatePipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.cast-control--connected]': 'connectedDeviceName()',
        '[class.cast-control--inline]': "placement() === 'inline'",
    },
})
export class CastControlComponent {
    readonly playback = input.required<ResolvedPortalPlayback>();
    readonly placement = input<'overlay' | 'inline'>('overlay');

    readonly dlnaDevices = signal<readonly DlnaRendererDevice[]>([]);
    readonly discovering = signal(false);
    readonly airPlayAvailable = signal(false);
    readonly remotePlaybackAvailable = signal(false);
    readonly connectedDeviceName = signal('');
    readonly statusKey = signal('');
    readonly directCastingAvailable = computed(
        () =>
            isDirectCastUrl(this.playback().streamUrl) &&
            !hasPlaybackHeaders(this.playback())
    );
    readonly googleCastAvailable = computed(() =>
        this.castService.canUseGoogleCast(this.playback())
    );
    readonly dlnaAvailable = computed(() => this.castService.supportsDlna);

    private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly castService = inject(CastService);

    async prepareMenu(): Promise<void> {
        const media = this.getMediaElement();
        this.airPlayAvailable.set(this.castService.supportsAirPlay(media));
        this.remotePlaybackAvailable.set(
            this.castService.supportsRemotePlayback(media)
        );
        if (this.dlnaAvailable()) {
            await this.refreshDlnaDevices();
        }
    }

    openAirPlay(media = this.getMediaElement()): void {
        if (!media) {
            return;
        }
        this.castService.openAirPlayPicker(media);
    }

    async openRemotePlayback(media = this.getMediaElement()): Promise<void> {
        if (!media) {
            return;
        }
        await this.runCastAction(() =>
            this.castService.openRemotePlaybackPicker(media)
        );
    }

    async startGoogleCast(): Promise<void> {
        await this.runCastAction(() =>
            this.castService.startGoogleCast(this.playback())
        );
    }

    async refreshDlnaDevices(): Promise<void> {
        this.discovering.set(true);
        this.statusKey.set('');
        try {
            this.dlnaDevices.set(await this.castService.discoverDlnaDevices());
        } catch {
            this.statusKey.set('CASTING.DISCOVERY_FAILED');
        } finally {
            this.discovering.set(false);
        }
    }

    async startDlnaPlayback(deviceId: string): Promise<void> {
        const device = this.dlnaDevices().find(({ id }) => id === deviceId);
        await this.runCastAction(async () => {
            await this.castService.startDlnaPlayback(deviceId, this.playback());
            this.connectedDeviceName.set(device?.name ?? '');
        });
    }

    private async runCastAction(action: () => Promise<void>): Promise<void> {
        this.statusKey.set('');
        try {
            await action();
        } catch {
            this.statusKey.set('CASTING.PLAYBACK_FAILED');
        }
    }

    private getMediaElement(): HTMLMediaElement | null {
        return findCastMediaElement(this.elementRef.nativeElement);
    }
}
