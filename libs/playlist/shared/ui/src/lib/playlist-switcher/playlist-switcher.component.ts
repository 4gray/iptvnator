import {
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    ConnectedPosition,
} from '@angular/cdk/overlay';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslateService } from '@ngx-translate/core';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import {
    PlaylistContextFacade,
    sourceDisplayName,
    sourceMetaParts,
} from '@iptvnator/playlist/shared/util';
import { injectTranslationTick } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { SourceTileComponent } from '../source-row/source-tile.component';
import { PlaylistSwitcherOpenService } from './playlist-switcher-open.service';
import { PlaylistSwitcherPanelComponent } from './playlist-switcher-panel.component';

/** Below the trigger's left edge, 8px down; above it when there is no room. */
const POSITIONS: ConnectedPosition[] = [
    {
        originX: 'start',
        originY: 'bottom',
        overlayX: 'start',
        overlayY: 'top',
        offsetY: 8,
    },
    {
        originX: 'start',
        originY: 'top',
        overlayX: 'start',
        overlayY: 'bottom',
        offsetY: -8,
    },
];
/** The popover keeps this far from the window's bottom edge. */
const VIEWPORT_MARGIN = 12;

/**
 * The toolbar playlist switcher: a trigger showing the active source and a
 * popover (`app-playlist-switcher-panel`) in a CDK overlay, so row menus
 * open above it rather than inside its scrolling list. Opens on click and
 * on ⌘P / Ctrl+P; Escape closes it and returns focus to the trigger.
 */
@Component({
    selector: 'app-playlist-switcher',
    imports: [
        CdkConnectedOverlay,
        CdkOverlayOrigin,
        MatIcon,
        PlaylistSwitcherPanelComponent,
        SourceTileComponent,
    ],
    templateUrl: './playlist-switcher.component.html',
    styleUrls: ['./playlist-switcher.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '(window:resize)': 'onWindowResize()' },
})
export class PlaylistSwitcherComponent {
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly statusService = inject(SourceStatusService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
    private readonly trigger =
        viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

    readonly currentTitle = input.required<string>();
    /** Shown under the name while no source is active ("3 sources"). */
    readonly subtitle = input<string>('');
    readonly playlistSelected = output<string>();
    readonly accountInfoForPlaylistRequested = output<PlaylistMeta>();
    readonly addPlaylistRequested = output<void>();

    readonly positions = POSITIONS;
    readonly isOpen = signal(false);
    readonly maxHeight = signal<string | null>(null);
    readonly activePlaylistId = this.playlistContext.resolvedPlaylistId;
    readonly activePlaylist = this.playlistContext.activePlaylist;

    /** The active source's name; never its URL or a credential. */
    readonly displayTitle = computed(() => {
        this.languageTick();
        if (!this.activePlaylistId()) {
            return this.translate.instant('HOME.PLAYLISTS.SELECT_PLAYLIST');
        }
        const active = this.activePlaylist();
        return (
            (active ? sourceDisplayName(active) : this.currentTitle()) ||
            this.translate.instant('HOME.PLAYLISTS.UNTITLED_PLAYLIST')
        );
    });
    /** "Stalker", "M3U · 3,220 channels", or the header's source count. */
    readonly triggerSubtitle = computed(() => {
        this.languageTick();
        const active = this.activePlaylist();
        if (!active) {
            return this.subtitle();
        }
        return sourceMetaParts(
            active,
            {
                translate: (key, params) => this.translate.instant(key, params),
                locale: normalizeDateLocale(
                    this.translate.currentLang || this.translate.defaultLang
                ),
                now: Date.now(),
            },
            true
        )
            .filter((part) => part.kind === 'type' || part.kind === 'channels')
            .map((part) => part.text)
            .join(' · ');
    });
    readonly activeStatus = computed(() => {
        const active = this.activePlaylist();
        return active ? this.statusService.statusOf(active) : null;
    });

    constructor() {
        const openService = inject(PlaylistSwitcherOpenService);
        const unregister = openService.register();
        const requests = openService.openRequests.subscribe(() => this.open());
        inject(DestroyRef).onDestroy(() => {
            unregister();
            requests.unsubscribe();
        });
    }

    toggle(): void {
        if (this.isOpen()) {
            this.close();
        } else {
            this.open();
        }
    }

    open(): void {
        this.fitToViewport();
        this.isOpen.set(true);
    }

    /** A window resized while the popover is open refits it. */
    onWindowResize(): void {
        if (this.isOpen()) {
            this.fitToViewport();
        }
    }

    /** Caps the popover to the room below the trigger; only its list scrolls. */
    private fitToViewport(): void {
        const bottom =
            this.trigger().nativeElement.getBoundingClientRect().bottom;
        this.maxHeight.set(
            `${Math.max(240, window.innerHeight - bottom - 8 - VIEWPORT_MARGIN)}px`
        );
    }

    /** Closes the popover; focus goes back to the trigger. */
    close(): void {
        if (!this.isOpen()) {
            return;
        }
        this.isOpen.set(false);
        this.trigger().nativeElement.focus();
    }

    onOverlayKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.close();
        }
    }
}
