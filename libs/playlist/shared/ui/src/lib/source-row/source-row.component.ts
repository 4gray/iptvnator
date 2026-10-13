import { Clipboard } from '@angular/cdk/clipboard';
import { DragDropModule } from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import { injectTranslationTick } from '@iptvnator/services';
import {
    isPortalAccountPlaylist,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import {
    sourceCopyUrl,
    sourceDisplayName,
    SourceFormatContext,
    sourceMetaParts,
    sourceStatusTag,
} from '@iptvnator/playlist/shared/util';
import { SourceClock } from './source-clock';
import { SourceTileComponent } from './source-tile.component';

/**
 * One source in a list: the Sources page (`regular`, 56px, hover actions)
 * or the playlist switcher (`compact`, 52px, a ⋯ menu only).
 *
 * The regular row opens from the keyboard through its title block, a
 * `role="button"` sibling of the drag handle and the actions, so no control
 * sits inside a button. In the switcher the host is a listbox option driven
 * by `aria-activedescendant`; its ⋯ is pointer-only and the list opens the
 * menu from the keyboard (`openMenu()`).
 */
@Component({
    selector: 'app-source-row',
    imports: [
        DragDropModule,
        MatButton,
        MatDivider,
        MatIcon,
        MatIconButton,
        MatMenuModule,
        MatProgressBar,
        MatProgressSpinner,
        MatTooltip,
        SourceTileComponent,
        TranslatePipe,
    ],
    templateUrl: './source-row.component.html',
    styleUrl: './source-row.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceRowComponent {
    private readonly statusService = inject(SourceStatusService);
    private readonly clock = inject(SourceClock);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
    private readonly clipboard = inject(Clipboard);
    private readonly snackBar = inject(MatSnackBar);
    private readonly menuTrigger = viewChild(MatMenuTrigger);

    readonly playlist = input.required<PlaylistMeta>();
    readonly size = input<'regular' | 'compact'>('regular');
    /** The active playlist (switcher): filled row, check mark, ⋯ shown. */
    readonly current = input(false);
    /** The keyboard highlight of the switcher's listbox. */
    readonly highlighted = input(false);
    /** Runs a passive reachability check while the row is shown. */
    readonly checkHealth = input(true);
    readonly canRefresh = input(false);
    readonly draggable = input(false);
    readonly refreshing = input(false);
    readonly deleting = input(false);
    readonly busyMessage = input('');
    readonly busyProgress = input<number | null>(null);
    readonly canCancelBusy = input(false);
    /** False while something else, such as a refresh, holds the source. */
    readonly removable = input(true);

    readonly activated = output<void>();
    readonly refreshRequested = output<void>();
    readonly editRequested = output<void>();
    readonly removeRequested = output<void>();
    readonly cancelBusyRequested = output<void>();
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();
    readonly menuClosed = output<void>();

    readonly menuOpen = signal(false);
    readonly compact = computed(() => this.size() === 'compact');
    readonly busy = computed(() => this.refreshing() || this.deleting());
    readonly status = computed(() =>
        this.statusService.statusOf(this.playlist())
    );
    readonly failing = computed(() => {
        const reachability = this.status()?.reachability;
        return reachability === 'bad' || reachability === 'expired';
    });
    readonly canRecheck = computed(() =>
        this.statusService.tracks(this.playlist())
    );
    readonly copyUrl = computed(() => sourceCopyUrl(this.playlist()));
    readonly hasAccountInfo = computed(() =>
        isPortalAccountPlaylist(this.playlist())
    );

    private readonly formatContext = computed<SourceFormatContext>(() => {
        this.languageTick();
        return {
            translate: (key, params) => this.translate.instant(key, params),
            locale: normalizeDateLocale(
                this.translate.currentLang || this.translate.defaultLang
            ),
            now: Date.now(),
        };
    });
    readonly name = computed(() => {
        this.languageTick();
        return (
            sourceDisplayName(this.playlist()) ??
            this.translate.instant('HOME.PLAYLISTS.UNTITLED_PLAYLIST')
        );
    });
    readonly meta = computed(() =>
        sourceMetaParts(this.playlist(), this.formatContext(), this.compact())
    );
    /** Reads the shared clock, so a failure's duration keeps counting. */
    readonly tag = computed(() =>
        sourceStatusTag(
            this.status(),
            { ...this.formatContext(), now: this.clock.now() },
            this.compact()
        )
    );

    constructor() {
        effect((onCleanup) => {
            const playlist = this.playlist();
            if (!this.checkHealth()) {
                return;
            }
            const controller = new AbortController();
            untracked(() =>
                this.statusService.ensureChecked(playlist, controller.signal)
            );
            onCleanup(() => controller.abort());
        });
    }

    onRowClick(): void {
        if (!this.busy()) {
            this.activated.emit();
        }
    }

    /** Enter/Space on the title block; Space must not scroll the page. */
    onActivationKey(event: Event): void {
        event.preventDefault();
        this.onRowClick();
    }

    /** `R` refreshes the focused row, as its menu item says. */
    onRowKeydown(event: KeyboardEvent): void {
        const plain =
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey;
        if (
            plain &&
            event.key.toLowerCase() === 'r' &&
            !this.compact() &&
            this.canRefresh() &&
            !this.busy()
        ) {
            event.preventDefault();
            this.refreshRequested.emit();
        }
    }

    recheck(): void {
        this.statusService.recheck(this.playlist());
    }

    copyUrlToClipboard(): void {
        const url = this.copyUrl();
        if (url && this.clipboard.copy(url)) {
            this.snackBar.open(
                this.translate.instant('HOME.PLAYLISTS.INFO_DIALOG.URL_COPIED'),
                undefined,
                { duration: 2000 }
            );
        }
    }

    /** Opens the ⋯ menu from the keyboard (switcher: Shift+F10). */
    openMenu(): void {
        this.menuTrigger()?.openMenu();
    }

    onMenuClosed(): void {
        this.menuOpen.set(false);
        this.menuClosed.emit();
    }
}
