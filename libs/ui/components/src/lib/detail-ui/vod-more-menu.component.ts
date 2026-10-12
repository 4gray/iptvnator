import {
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    type ConnectedPosition,
} from '@angular/cdk/overlay';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type {
    VodSourceDescriptor,
    VodSourceMatchKind,
} from '@iptvnator/shared/interfaces';
import { VodSourcesMenuComponent } from '../vod-sources/vod-sources-menu.component';
import type {
    VodMoreMenuItem,
    VodMoreMenuSection,
} from './vod-more-menu.model';

type MenuView = 'menu' | 'sources';

/**
 * The "…" button of the details action row and its dropdown. Right edges
 * align with the button so the panel never leaves the details column; when
 * the space below is short the panel opens upward. Rows are plain buttons
 * with `role="menuitem"`, reachable with the arrow keys; Escape and an
 * outside click close the menu. Selecting the `sources` row swaps the panel
 * to the alternative-sources list.
 */
@Component({
    selector: 'app-vod-more-menu',
    imports: [
        CdkConnectedOverlay,
        CdkOverlayOrigin,
        MatIcon,
        MatTooltip,
        TranslatePipe,
        VodSourcesMenuComponent,
    ],
    templateUrl: './vod-more-menu.component.html',
    styleUrl: './vod-more-menu.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VodMoreMenuComponent {
    readonly sections = input.required<readonly VodMoreMenuSection[]>();
    readonly label = input.required<string>();
    readonly testId = input<string | null>(null);

    // Alternative sources, shown by the `sources` row.
    readonly sources = input<VodSourceDescriptor[]>([]);
    readonly sourcesTitle = input('');
    readonly matchKind = input<VodSourceMatchKind>('title-year');
    readonly autoFailoverEnabled = input(false);
    readonly autoFailoverSupported = input(true);
    readonly playbackLive = input(false);
    readonly resumeLabel = input<string | null>(null);

    readonly selected = output<string>();
    readonly sourcePlayRequested = output<string>();
    readonly sourcePinRequested = output<string>();
    readonly sourceCheckRequested = output<string>();
    readonly autoFailoverToggled = output<boolean>();

    readonly isOpen = signal(false);
    readonly view = signal<MenuView>('menu');
    readonly hasRows = computed(() =>
        this.sections().some((section) => section.items.length > 0)
    );

    private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
    private readonly trigger =
        viewChild.required<ElementRef<HTMLButtonElement>>('triggerButton');

    /** Below the button, right-aligned; above it when the space below is short. */
    readonly overlayPositions: ConnectedPosition[] = [
        {
            originX: 'end',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top',
            offsetY: 6,
            panelClass: 'vod-more-menu-pane--below',
        },
        {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom',
            offsetY: -6,
            panelClass: 'vod-more-menu-pane--above',
        },
    ];

    toggle(): void {
        if (this.isOpen()) {
            this.close();
            return;
        }
        this.view.set('menu');
        this.isOpen.set(true);
        this.focusRow(0);
    }

    close(restoreFocus = false): void {
        if (!this.isOpen()) {
            return;
        }
        this.isOpen.set(false);
        this.view.set('menu');
        if (restoreFocus) {
            this.trigger().nativeElement.focus();
        }
    }

    showMenu(): void {
        this.view.set('menu');
        this.focusRow(0);
    }

    select(item: VodMoreMenuItem): void {
        if (item.disabled) {
            return;
        }
        if (item.kind === 'sources') {
            this.view.set('sources');
            this.focusFirstControl();
            return;
        }
        this.close(true);
        this.selected.emit(item.id);
    }

    onOverlayKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.close(true);
        } else if (event.key === 'Tab') {
            this.close();
        }
    }

    onTriggerKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown' && !this.isOpen()) {
            event.preventDefault();
            this.toggle();
        }
    }

    onMenuKeydown(event: KeyboardEvent): void {
        if (this.view() !== 'menu') {
            return;
        }
        const rows = this.rows();
        if (rows.length === 0) {
            return;
        }
        const current = rows.indexOf(document.activeElement as HTMLElement);
        let next: number | null = null;
        switch (event.key) {
            case 'ArrowDown':
                next = (current + 1) % rows.length;
                break;
            case 'ArrowUp':
                next = (current - 1 + rows.length) % rows.length;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = rows.length - 1;
                break;
        }
        if (next !== null) {
            event.preventDefault();
            rows[next].focus();
        }
    }

    /** Playing from a row hands the screen back to the player. */
    onSourcePlay(sourceId: string): void {
        this.close();
        this.sourcePlayRequested.emit(sourceId);
    }

    onSourcePin(sourceId: string): void {
        this.close();
        this.sourcePinRequested.emit(sourceId);
    }

    private rows(): HTMLElement[] {
        const panel = this.panel()?.nativeElement;
        return panel
            ? Array.from(
                  panel.querySelectorAll<HTMLElement>(
                      '[role="menuitem"]:not([disabled])'
                  )
              )
            : [];
    }

    private focusRow(index: number): void {
        // The overlay attaches after this change detection pass.
        setTimeout(() => this.rows()[index]?.focus());
    }

    /** The sources panel replaces the focused row; focus follows into it. */
    private focusFirstControl(): void {
        setTimeout(() =>
            this.panel()
                ?.nativeElement.querySelector<HTMLElement>(
                    'button:not([disabled])'
                )
                ?.focus()
        );
    }
}
