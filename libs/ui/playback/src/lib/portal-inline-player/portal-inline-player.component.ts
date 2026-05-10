import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
    PlayerContentInfo,
    ResolvedPortalPlayback,
} from 'shared-interfaces';
import type { PlaybackFallbackRequest } from '../playback-diagnostics/playback-diagnostics.util';
import { WebPlayerViewComponent } from '../web-player-view/web-player-view.component';

@Component({
    selector: 'app-portal-inline-player',
    templateUrl: './portal-inline-player.component.html',
    styleUrl: './portal-inline-player.component.scss',
    imports: [
        ClipboardModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'portal-inline-player',
        '[attr.data-has-player]': 'hasPlayback()',
    },
})
export class PortalInlinePlayerComponent {
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly title = computed(() => this.playback()?.title ?? '');
    readonly streamUrl = computed(() => this.playback()?.streamUrl ?? '');
    readonly startTime = computed(() => this.playback()?.startTime ?? 0);
    readonly contentInfo = computed<PlayerContentInfo | undefined>(
        () => this.playback()?.contentInfo
    );
    readonly hasPlayback = computed(() => !!this.playback()?.streamUrl);

    readonly closed = output<void>();
    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();

    onClose(): void {
        this.closed.emit();
    }

    onTimeUpdate(event: { currentTime: number; duration: number }): void {
        this.timeUpdate.emit(event);
    }

    onCopied(): void {
        this.streamUrlCopied.emit();
    }

    onExternalFallbackRequested(request: PlaybackFallbackRequest): void {
        this.externalFallbackRequested.emit(request);
    }
}
