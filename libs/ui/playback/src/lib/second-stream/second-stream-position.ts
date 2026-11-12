import { computed, signal } from '@angular/core';

/** Relative viewport placement survives resize, with separate fullscreen placement. */
export class SecondStreamPosition {
    readonly area = signal<{
        width: number;
        height: number;
    }>({ width: 0, height: 0 });
    private measured = false;
    private fullscreen = false;
    private windowPoint = { x: 1, y: 0.45 };
    private windowWidth = 320;
    readonly preferredWidth = signal(320);
    readonly resizing = signal(false);
    readonly maximumWidth = computed(() =>
        Math.max(
            0,
            Math.min(
                640,
                this.area().width - 16,
                ((this.area().height - 16) * 16) / 9
            )
        )
    );
    readonly minimumWidth = computed(() => Math.min(240, this.maximumWidth()));
    readonly point = signal({ x: 1, y: 0.45 });
    readonly dragging = signal(false);
    readonly geometry = computed(() => {
        const area = this.area();
        const width = Math.max(
            this.minimumWidth(),
            Math.min(this.preferredWidth(), this.maximumWidth())
        );
        const height = (width * 9) / 16;
        const travelX = Math.max(0, area.width - width - 16);
        const travelY = Math.max(0, area.height - height - 16);
        return {
            width,
            height,
            left: 8 + this.point().x * travelX,
            top: 8 + this.point().y * travelY,
            travelX,
            travelY,
        };
    });
    measure(
        stage: { left: number; top: number; width: number; height: number },
        viewport: { width: number; height: number },
        fullscreen: boolean
    ): void {
        if (fullscreen !== this.fullscreen) {
            if (fullscreen) {
                this.windowPoint = this.point();
                this.windowWidth = this.preferredWidth();
            } else {
                this.point.set(this.windowPoint);
                this.preferredWidth.set(this.windowWidth);
            }
            this.fullscreen = fullscreen;
        }
        this.area.set(viewport);
        if (!this.measured) {
            this.measured = true;
            const { width, height } = this.geometry();
            this.place(
                stage.left + stage.width - width - 8,
                stage.top + 8 + Math.max(0, stage.height - height - 16) * 0.45
            );
        }
    }
    private start: {
        id: number;
        x: number;
        y: number;
        left: number;
        top: number;
        width: number;
        mode: 'move' | 'left' | 'right';
    } | null = null;

    down(event: PointerEvent, mode: 'move' | 'left' | 'right' = 'move'): void {
        if (event.button !== 0 || this.start) return;
        event.preventDefault();
        const geometry = this.geometry();
        this.start = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: geometry.left,
            top: geometry.top,
            width: geometry.width,
            mode,
        };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.dragging.set(mode === 'move');
        this.resizing.set(mode !== 'move');
    }
    move(event: PointerEvent): void {
        if (event.pointerId !== this.start?.id) return;
        if (this.start.mode !== 'move') {
            const dx =
                (event.clientX - this.start.x) *
                (this.start.mode === 'left' ? -1 : 1);
            const dy = ((event.clientY - this.start.y) * 16) / 9;
            this.resize(
                this.start.width + (Math.abs(dx) >= Math.abs(dy) ? dx : dy),
                this.start.left,
                this.start.top,
                this.start.width,
                this.start.mode
            );
            return;
        }
        this.place(
            this.start.left + event.clientX - this.start.x,
            this.start.top + event.clientY - this.start.y
        );
    }
    up(event: PointerEvent): void {
        if (event.pointerId !== this.start?.id) return;
        this.start = null;
        this.dragging.set(false);
        this.resizing.set(false);
    }
    key(event: KeyboardEvent): void {
        const delta = {
            ArrowLeft: [-16, 0],
            ArrowRight: [16, 0],
            ArrowUp: [0, -16],
            ArrowDown: [0, 16],
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        const { left, top } = this.geometry();
        this.place(left + delta[0], top + delta[1]);
    }
    resizeKey(event: KeyboardEvent, corner: 'left' | 'right'): void {
        const delta = {
            ArrowRight: 16,
            ArrowUp: 16,
            ArrowLeft: -16,
            ArrowDown: -16,
        }[event.key];
        if (delta === undefined && event.key !== 'Home' && event.key !== 'End')
            return;
        event.preventDefault();
        event.stopPropagation();
        const { left, top, width } = this.geometry();
        const requested =
            event.key === 'Home'
                ? this.minimumWidth()
                : event.key === 'End'
                  ? this.maximumWidth()
                  : width + (delta ?? 0);
        this.resize(requested, left, top, width, corner);
    }
    private resize(
        requested: number,
        left: number,
        top: number,
        width: number,
        corner: 'left' | 'right'
    ): void {
        this.preferredWidth.set(
            Math.max(
                this.minimumWidth(),
                Math.min(requested, this.maximumWidth())
            )
        );
        this.place(
            corner === 'left' ? left + width - this.geometry().width : left,
            top
        );
    }
    private place(left: number, top: number): void {
        const { travelX, travelY } = this.geometry();
        const clamp = (value: number) => Math.max(0, Math.min(1, value));
        this.point.set({
            x: travelX ? clamp((left - 8) / travelX) : 0,
            y: travelY ? clamp((top - 8) / travelY) : 0,
        });
    }
}
