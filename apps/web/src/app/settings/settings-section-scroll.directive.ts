import {
    AfterViewInit,
    Directive,
    effect,
    ElementRef,
    inject,
    Injector,
    OnDestroy,
} from '@angular/core';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';
import { ObservedSettingsSection } from './settings.models';

@Directive({
    selector: '[appSettingsSectionScroll]',
})
export class SettingsSectionScrollDirective
    implements AfterViewInit, OnDestroy
{
    private static readonly SECTION_SCROLL_TOP_GUTTER = 112;
    private static readonly SECTION_SCROLL_BOTTOM_GUTTER = 124;
    private static readonly PENDING_SCROLL_CLEAR_DELAY_MS = 600;

    private readonly elementRef = inject(ElementRef<HTMLElement>);
    private readonly injector = inject(Injector);
    private readonly settingsCtx = inject(SettingsContextService);

    private sectionObserver?: IntersectionObserver;
    private pendingScrollClearTimer: ReturnType<
        typeof window.setTimeout
    > | null = null;
    private pendingScrollClearRoot: HTMLElement | null = null;
    private pendingScrollEndListener: (() => void) | null = null;

    constructor() {
        effect(
            () => {
                const sectionId = this.settingsCtx.pendingScrollTarget();
                if (!sectionId || typeof document === 'undefined') {
                    return;
                }

                const scrollRoot = this.scrollToSection(sectionId);
                this.schedulePendingScrollTargetClear(scrollRoot);
            },
            { injector: this.injector }
        );

        // The previous active-section change handler ran a 260ms box-shadow
        // animation (inset 1px ring + soft glow) on whichever section
        // became active during scroll. With the new flat layout (no card
        // chrome, no static active ring) that pulse drew a brief 1px
        // border around each block as the user scrolled past — what the
        // user reported as "short border kind of highlight around blocks".
        // The rail's left active state already announces the current
        // section, so the inline pulse is redundant. Removed entirely.
    }

    ngAfterViewInit(): void {
        requestAnimationFrame(() => this.setupSectionObserver());
    }

    ngOnDestroy(): void {
        this.cancelPendingScrollTargetClear();
        this.sectionObserver?.disconnect();
    }

    private setupSectionObserver(): void {
        if (typeof IntersectionObserver === 'undefined') {
            return;
        }

        const scrollRoot = this.getScrollRoot();
        const contentSections = Array.from(
            this.elementRef.nativeElement.querySelectorAll(
                '.settings-group[id]'
            )
        ) as HTMLElement[];
        const sections: ObservedSettingsSection[] = contentSections.map(
            (section) => ({
                id: section.id,
                element: section,
            })
        );

        if (sections.length === 0) {
            return;
        }

        this.sectionObserver?.disconnect();
        this.sectionObserver = new IntersectionObserver(
            () => {
                if (this.settingsCtx.pendingScrollTarget()) {
                    return;
                }

                const activeSection = this.resolveActiveSection(sections);
                if (activeSection) {
                    this.settingsCtx.setActiveSection(activeSection);
                }
            },
            {
                root: scrollRoot,
                threshold: [0.12, 0.24, 0.4, 0.6],
                rootMargin: '-18% 0px -52% 0px',
            }
        );

        sections.forEach((section) =>
            this.sectionObserver?.observe(section.element)
        );

        const initialSection = this.resolveActiveSection(sections);
        if (initialSection) {
            this.settingsCtx.setActiveSection(initialSection);
        }
    }

    private resolveActiveSection(
        sections: ObservedSettingsSection[]
    ): string | null {
        const scrollRoot = this.getScrollRoot();
        const rootTop = scrollRoot?.getBoundingClientRect().top ?? 0;
        const rootHeight = scrollRoot?.clientHeight ?? window.innerHeight;
        const activationLine = rootTop + Math.min(rootHeight * 0.28, 220);
        const sectionAtActivationLine = sections.find((section) => {
            const rect = section.element.getBoundingClientRect();
            return rect.top <= activationLine && rect.bottom >= activationLine;
        });

        if (sectionAtActivationLine) {
            return sectionAtActivationLine.id;
        }

        const nearestSection = sections
            .map((section) => ({
                id: section.id,
                distance: Math.abs(
                    section.element.getBoundingClientRect().top - activationLine
                ),
            }))
            .sort((a, b) => a.distance - b.distance)[0];

        return nearestSection?.id ?? null;
    }

    private getScrollRoot(): HTMLElement | null {
        return this.elementRef.nativeElement.closest(
            'main.workspace-content'
        ) as HTMLElement | null;
    }

    private schedulePendingScrollTargetClear(
        scrollRoot: HTMLElement | null
    ): void {
        const clearPendingScrollTarget = () => {
            this.cancelPendingScrollTargetClear();
            this.settingsCtx.clearPendingScrollTarget();
        };

        this.cancelPendingScrollTargetClear();
        this.pendingScrollClearTimer = window.setTimeout(
            clearPendingScrollTarget,
            SettingsSectionScrollDirective.PENDING_SCROLL_CLEAR_DELAY_MS
        );
        this.pendingScrollClearRoot = scrollRoot;
        this.pendingScrollEndListener = clearPendingScrollTarget;
        scrollRoot?.addEventListener?.('scrollend', clearPendingScrollTarget, {
            once: true,
        });
    }

    private cancelPendingScrollTargetClear(): void {
        if (this.pendingScrollClearTimer) {
            clearTimeout(this.pendingScrollClearTimer);
            this.pendingScrollClearTimer = null;
        }

        if (this.pendingScrollClearRoot && this.pendingScrollEndListener) {
            this.pendingScrollClearRoot.removeEventListener?.(
                'scrollend',
                this.pendingScrollEndListener
            );
        }

        this.pendingScrollClearRoot = null;
        this.pendingScrollEndListener = null;
    }

    private scrollToSection(sectionId: string): HTMLElement | null {
        const sectionElement = document.getElementById(sectionId);
        if (!sectionElement) {
            return null;
        }

        const scrollRoot = this.getScrollRoot();
        if (!scrollRoot) {
            sectionElement.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
            return null;
        }

        const rootRect = scrollRoot.getBoundingClientRect();
        const sectionRect = sectionElement.getBoundingClientRect();
        const sectionTop =
            scrollRoot.scrollTop + (sectionRect.top - rootRect.top);
        const sectionBottom = sectionTop + sectionRect.height;
        const visibleTop =
            scrollRoot.scrollTop +
            SettingsSectionScrollDirective.SECTION_SCROLL_TOP_GUTTER;
        const visibleBottom =
            scrollRoot.scrollTop +
            scrollRoot.clientHeight -
            SettingsSectionScrollDirective.SECTION_SCROLL_BOTTOM_GUTTER;
        let nextScrollTop = scrollRoot.scrollTop;

        if (sectionTop < visibleTop) {
            nextScrollTop =
                sectionTop -
                SettingsSectionScrollDirective.SECTION_SCROLL_TOP_GUTTER;
        } else if (sectionBottom > visibleBottom) {
            nextScrollTop =
                sectionBottom -
                scrollRoot.clientHeight +
                SettingsSectionScrollDirective.SECTION_SCROLL_BOTTOM_GUTTER;
        }

        const maxScrollTop = Math.max(
            0,
            scrollRoot.scrollHeight - scrollRoot.clientHeight
        );

        scrollRoot.scrollTo({
            top: Math.min(Math.max(nextScrollTop, 0), maxScrollTop),
            behavior: 'smooth',
        });

        return scrollRoot;
    }
}
