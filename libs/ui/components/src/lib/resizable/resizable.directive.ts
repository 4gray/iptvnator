import {
    Directive,
    ElementRef,
    Renderer2,
    inject,
    input,
    output,
    OnInit,
    OnDestroy,
    effect,
    signal,
    AfterViewInit,
} from '@angular/core';

const SHARED_SIDEBAR_WIDTH_KEY = 'sidebar-width';
const SIDEBAR_WIDTH_KEY_ALIASES = new Set([
    SHARED_SIDEBAR_WIDTH_KEY,
    'downloads-sidebar-width',
    'workspace-sources-panel-width',
    'workspace-context-panel-width',
    'workspace-settings-panel-width',
    'workspace-favorites-panel-width',
    'iptvnator_video_sidebar_width',
]);

function parseStoredWidth(value: string): number | null {
    const width = parseInt(value, 10);
    return Number.isNaN(width) ? null : width;
}

/**
 * ResizableDirective - Makes an element horizontally resizable by dragging its edge.
 *
 * Usage:
 * ```html
 * <div appResizable [minWidth]="200" [maxWidth]="600" [storageKey]="'sidebar-width'">
 *   Content here
 * </div>
 * ```
 *
 * Features:
 * - Smooth drag handle with visual feedback
 * - Persists width to localStorage
 * - Respects min/max width constraints
 * - Emits width changes for reactive updates
 */
@Directive({
    selector: '[appResizable]',
    standalone: true,
})
export class ResizableDirective implements OnInit, AfterViewInit, OnDestroy {
    /** Minimum width in pixels */
    readonly minWidth = input<number>(200);

    /** Maximum width in pixels */
    readonly maxWidth = input<number>(600);

    /** LocalStorage key for persisting width. Defaults to shared sidebar key when omitted. */
    readonly storageKey = input<string>('');

    /** Default width to use when no stored value exists */
    readonly defaultWidth = input<number>(400);

    /** Position of the resize handle: 'right' or 'left' */
    readonly handlePosition = input<'right' | 'left'>('right');

    /** Emits when width changes during resize */
    readonly widthChange = output<number>();

    /** Emits when resize starts */
    readonly resizeStart = output<void>();

    /** Emits when a resize that moved the edge ends, with the kept width */
    readonly resizeEnd = output<number>();

    /**
     * Emits instead of `resizeEnd` when the edge did not move: a click on
     * the handle, or a drag a CSS cap stopped. Carries the saved width,
     * which stands, so a host that mirrored `widthChange` can restore it.
     */
    readonly resizeCancel = output<number>();

    private handleElement: HTMLElement | null = null;
    private isResizing = signal(false);
    private startX = 0;
    private startWidth = 0;
    private widthBeforeResize = 0;
    private currentWidth = signal(0);

    // Event listener references for cleanup
    private boundMouseMove: ((e: MouseEvent) => void) | null = null;
    private boundMouseUp: ((e: MouseEvent) => void) | null = null;
    private boundTouchMove: ((e: TouchEvent) => void) | null = null;
    private boundTouchEnd: ((e: TouchEvent) => void) | null = null;
    private readonly el = inject(ElementRef<HTMLElement>);
    private readonly renderer = inject(Renderer2);

    constructor() {
        // Apply resizing class when dragging
        effect(() => {
            if (this.isResizing()) {
                this.renderer.addClass(document.body, 'resizing-active');
                this.renderer.addClass(this.el.nativeElement, 'is-resizing');
            } else {
                this.renderer.removeClass(document.body, 'resizing-active');
                this.renderer.removeClass(this.el.nativeElement, 'is-resizing');
            }
        });
    }

    ngOnInit(): void {
        // Load persisted width FIRST to avoid flash of default width
        this.loadPersistedWidth();
        this.setupStyles();
    }

    ngAfterViewInit(): void {
        this.createResizeHandle();
    }

    ngOnDestroy(): void {
        this.removeGlobalListeners();
        if (this.handleElement) {
            this.handleElement.remove();
        }
    }

    private setupStyles(): void {
        const el = this.el.nativeElement;

        // Ensure the element has position relative for handle positioning
        const computedStyle = window.getComputedStyle(el);
        if (computedStyle.position === 'static') {
            this.renderer.setStyle(el, 'position', 'relative');
        }

        // Add transition for smooth width changes (only when not dragging)
        this.renderer.addClass(el, 'resizable-element');
    }

    private createResizeHandle(): void {
        const handle = this.renderer.createElement('div');
        this.handleElement = handle;

        // Set up handle classes based on position
        this.renderer.addClass(handle, 'resize-handle');
        this.renderer.addClass(
            handle,
            `resize-handle--${this.handlePosition()}`
        );

        // Create inner visual elements for the handle
        const handleLine = this.renderer.createElement('div');
        this.renderer.addClass(handleLine, 'resize-handle__line');
        this.renderer.appendChild(handle, handleLine);

        // Create grip dots
        const gripDots = this.renderer.createElement('div');
        this.renderer.addClass(gripDots, 'resize-handle__grip');
        for (let i = 0; i < 3; i++) {
            const dot = this.renderer.createElement('span');
            this.renderer.appendChild(gripDots, dot);
        }
        this.renderer.appendChild(handle, gripDots);

        // Mouse events
        this.renderer.listen(handle, 'mousedown', (e: MouseEvent) =>
            this.onMouseDown(e)
        );

        // Touch events for mobile support
        this.renderer.listen(handle, 'touchstart', (e: TouchEvent) =>
            this.onTouchStart(e)
        );

        // Append handle to element
        this.renderer.appendChild(this.el.nativeElement, handle);
    }

    /**
     * Sidebars sharing a key have different limits, so the stored width is
     * clamped for rendering only: writing it back would hand every other
     * sidebar the narrowest (or widest) limit. Only a user resize persists.
     */
    private loadPersistedWidth(): void {
        const storedWidth = this.readStoredWidth();
        this.setWidthImmediate(
            storedWidth === null
                ? this.defaultWidth()
                : this.clampWidth(storedWidth)
        );
    }

    /** The unclamped stored width, migrating a legacy key's raw value. */
    private readStoredWidth(): number | null {
        const { key, legacyKeys } = this.resolveStorageKey();
        const stored = localStorage.getItem(key);
        if (stored) {
            return parseStoredWidth(stored);
        }

        for (const legacyKey of legacyKeys) {
            const legacyValue = localStorage.getItem(legacyKey);
            if (!legacyValue) continue;

            const width = parseStoredWidth(legacyValue);
            if (width !== null) {
                localStorage.setItem(key, legacyValue);
                localStorage.removeItem(legacyKey);
            }
            return width;
        }

        return null;
    }

    /** Set width immediately without CSS transition */
    private setWidthImmediate(width: number): void {
        this.currentWidth.set(width);
        // Temporarily disable transition for immediate application
        this.renderer.setStyle(this.el.nativeElement, 'transition', 'none');
        this.renderer.setStyle(this.el.nativeElement, 'width', `${width}px`);

        // Re-enable transition after a frame
        requestAnimationFrame(() => {
            this.renderer.removeStyle(this.el.nativeElement, 'transition');
        });
    }

    private onMouseDown(e: MouseEvent): void {
        e.preventDefault();
        e.stopPropagation();

        this.startResize(e.clientX);

        this.boundMouseMove = (event: MouseEvent) => this.onMouseMove(event);
        this.boundMouseUp = () => this.onMouseUp();

        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);
    }

    private onTouchStart(e: TouchEvent): void {
        if (e.touches.length !== 1) return;

        e.preventDefault();
        e.stopPropagation();

        this.startResize(e.touches[0].clientX);

        this.boundTouchMove = (event: TouchEvent) => this.onTouchMove(event);
        this.boundTouchEnd = () => this.onTouchEnd();

        document.addEventListener('touchmove', this.boundTouchMove, {
            passive: false,
        });
        document.addEventListener('touchend', this.boundTouchEnd);
    }

    private startResize(clientX: number): void {
        this.isResizing.set(true);
        this.startX = clientX;
        this.startWidth = this.renderedWidth();
        // A host may drive the width through its own `[style.width.px]`
        // binding; the inline width is the one to keep if this is no resize.
        const inlineWidth = parseFloat(this.el.nativeElement.style.width);
        if (Number.isFinite(inlineWidth)) {
            this.currentWidth.set(inlineWidth);
        }
        this.widthBeforeResize = this.currentWidth();
        this.resizeStart.emit();
    }

    /**
     * The rendered width in the box `style.width` sizes: the content box for
     * a content-box host, the border box for a border-box one. `offsetWidth`
     * always includes padding and border, so starting from it widened padded
     * hosts by that amount on the first move.
     */
    private renderedWidth(): number {
        const width = parseFloat(
            window.getComputedStyle(this.el.nativeElement).width
        );
        return Number.isFinite(width) ? width : this.currentWidth();
    }

    /**
     * The width the element settles at, not a frame of a running width
     * transition (the directive's own, or a host's rail animation): turning
     * the transition off for the read cancels it, and turning it back on
     * starts nothing, since the width does not change again. Enclosing
     * resizable elements are settled too: a nested rail (the M3U Groups rail)
     * caps itself against a parent sidebar that its own drag is resizing.
     */
    private settledWidth(): number {
        const el: HTMLElement = this.el.nativeElement;
        const settled: HTMLElement[] = [el];
        let parent = el.parentElement?.closest<HTMLElement>(
            '.resizable-element'
        );
        while (parent) {
            settled.push(parent);
            parent = parent.parentElement?.closest<HTMLElement>(
                '.resizable-element'
            );
        }
        const inline = settled.map((element) => element.style.transition);
        settled.forEach((element) => (element.style.transition = 'none'));
        const width = this.renderedWidth();
        settled.forEach(
            (element, index) => (element.style.transition = inline[index])
        );
        return width;
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.isResizing()) return;
        this.resize(e.clientX);
    }

    private onTouchMove(e: TouchEvent): void {
        if (!this.isResizing() || e.touches.length !== 1) return;
        e.preventDefault();
        this.resize(e.touches[0].clientX);
    }

    private resize(clientX: number): void {
        const delta =
            this.handlePosition() === 'right'
                ? clientX - this.startX
                : this.startX - clientX;

        const newWidth = this.clampWidth(this.startWidth + delta);
        this.setWidth(newWidth);
        this.widthChange.emit(newWidth);
    }

    private onMouseUp(): void {
        this.endResize();
    }

    private onTouchEnd(): void {
        this.endResize();
    }

    private endResize(): void {
        if (!this.isResizing()) return;

        const rendered = this.settledWidth();
        this.isResizing.set(false);
        this.removeGlobalListeners();
        if (rendered === this.startWidth) {
            // The edge did not move: a click on the handle, or a drag against
            // a CSS cap narrower than `maxWidth` (a responsive `max-width`).
            // Persisting would replace the saved width with the clamped one.
            if (this.currentWidth() !== this.widthBeforeResize) {
                this.setWidth(this.widthBeforeResize);
            }
            this.resizeCancel.emit(this.widthBeforeResize);
            return;
        }
        // Never save more than the CSS cap let the user see.
        if (rendered < this.currentWidth()) {
            this.setWidth(rendered);
        }
        if (this.currentWidth() !== this.widthBeforeResize) {
            this.persistWidth();
        }
        this.resizeEnd.emit(this.currentWidth());
    }

    private removeGlobalListeners(): void {
        if (this.boundMouseMove) {
            document.removeEventListener('mousemove', this.boundMouseMove);
            this.boundMouseMove = null;
        }
        if (this.boundMouseUp) {
            document.removeEventListener('mouseup', this.boundMouseUp);
            this.boundMouseUp = null;
        }
        if (this.boundTouchMove) {
            document.removeEventListener('touchmove', this.boundTouchMove);
            this.boundTouchMove = null;
        }
        if (this.boundTouchEnd) {
            document.removeEventListener('touchend', this.boundTouchEnd);
            this.boundTouchEnd = null;
        }
    }

    private clampWidth(width: number): number {
        return Math.max(this.minWidth(), Math.min(this.maxWidth(), width));
    }

    private setWidth(width: number): void {
        this.currentWidth.set(width);
        this.renderer.setStyle(this.el.nativeElement, 'width', `${width}px`);
    }

    private persistWidth(): void {
        const { key } = this.resolveStorageKey();
        if (key) {
            localStorage.setItem(key, this.currentWidth().toString());
        }
    }

    private resolveStorageKey(): { key: string; legacyKeys: string[] } {
        const rawKey = this.storageKey().trim();
        if (!rawKey) {
            return { key: SHARED_SIDEBAR_WIDTH_KEY, legacyKeys: [] };
        }

        if (SIDEBAR_WIDTH_KEY_ALIASES.has(rawKey)) {
            return {
                key: SHARED_SIDEBAR_WIDTH_KEY,
                legacyKeys: rawKey === SHARED_SIDEBAR_WIDTH_KEY ? [] : [rawKey],
            };
        }

        return { key: rawKey, legacyKeys: [] };
    }
}
