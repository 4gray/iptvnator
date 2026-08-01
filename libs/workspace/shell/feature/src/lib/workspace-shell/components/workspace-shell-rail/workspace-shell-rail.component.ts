import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    HostBinding,
    computed,
    effect,
    inject,
    input,
    model,
    signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    PortalRailLink,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';
import { map, startWith } from 'rxjs';
import { WORKSPACE_SHELL_COMPACT_MEDIA_QUERY } from '../../workspace-shell-layout.constants';
import { WorkspaceShellRailLinksComponent } from '../workspace-shell-rail-links/workspace-shell-rail-links.component';

const RTL_LANGUAGES = new Set(['ar', 'ary', 'fa', 'he', 'ur']);

@Component({
    selector: 'app-workspace-shell-rail',
    imports: [
        MatIcon,
        MatTooltip,
        RouterLink,
        TranslatePipe,
        WorkspaceShellRailLinksComponent,
    ],
    templateUrl: './workspace-shell-rail.component.html',
    styleUrl: './workspace-shell-rail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellRailComponent {
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly translate = inject(TranslateService);
    private readonly compactMediaQuery =
        this.document.defaultView?.matchMedia?.(
            WORKSPACE_SHELL_COMPACT_MEDIA_QUERY
        ) ?? null;
    private readonly fallbackLanguage =
        this.translate.currentLang || this.translate.defaultLang || 'en';
    private readonly activeLanguage = toSignal(
        this.translate.onLangChange.pipe(
            map((event) => event?.lang || this.fallbackLanguage),
            startWith(this.fallbackLanguage)
        ),
        { initialValue: this.fallbackLanguage }
    );

    readonly isMacOS = input(false);
    readonly expanded = model(false);
    readonly isCompact = signal(this.compactMediaQuery?.matches ?? false);
    readonly textDirection = computed<'ltr' | 'rtl'>(() => {
        const language = this.activeLanguage().toLowerCase().split('-')[0];
        return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
    });
    readonly workspaceLinks = input<PortalRailLink[]>([]);
    readonly primaryContextLinks = input<PortalRailLink[]>([]);
    readonly secondaryContextLinks = input<PortalRailLink[]>([]);
    readonly selectedSection = input<
        PortalRailSection | string | null | undefined
    >(null);
    readonly railProviderClass = input('rail-context-region');
    readonly isSettingsRoute = input(false);

    @HostBinding('class.rail-expanded')
    get railExpandedClass(): boolean {
        return this.expanded();
    }

    constructor() {
        effect(() => {
            if (this.isCompact() && this.expanded()) {
                this.expanded.set(false);
            }
        });

        const mediaQuery = this.compactMediaQuery;
        if (!mediaQuery) {
            return;
        }

        const updateCompactState = (matches: boolean): void => {
            this.isCompact.set(matches);
        };
        const onMediaChange = (event: MediaQueryListEvent): void =>
            updateCompactState(event.matches);

        mediaQuery.addEventListener?.('change', onMediaChange);
        this.destroyRef.onDestroy(() =>
            mediaQuery.removeEventListener?.('change', onMediaChange)
        );
    }

    toggleExpanded(): void {
        if (this.isCompact()) {
            return;
        }

        this.expanded.update((expanded) => !expanded);
    }
}
