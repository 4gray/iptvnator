import { DOCUMENT } from '@angular/common';
import {
    computed,
    Directive,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { MACOS_TRAFFIC_LIGHTS_POSITION } from '@iptvnator/shared/interfaces';

/**
 * The three buttons are 14 pt circles. macOS 26 spaces them 23 pt apart
 * (60 pt in all); earlier releases 20 pt (52 pt).
 */
const LIGHTS_WIDTH = 60;
const LIGHTS_HEIGHT = 14;
/**
 * Window points from the window's left edge to where header content may
 * start: the lights plus a gap. 84 is also where the header's content starts
 * at 100 % (the 60 px rail plus 24 px padding), so default zoom is unchanged.
 */
const CLEAR_X = MACOS_TRAFFIC_LIGHTS_POSITION.x + LIGHTS_WIDTH + 8;
/** Window points from the top to where the content area may start. */
const CLEAR_Y = MACOS_TRAFFIC_LIGHTS_POSITION.y + LIGHTS_HEIGHT + 14;

/** CSS pixels from the window's top-left corner that clear the lights. */
export interface TrafficLightsClearance {
    readonly x: number;
    readonly y: number;
}

/**
 * The page zoom factor. Chromium reports the window in window pixels and the
 * viewport in CSS pixels, so their ratio is the app zoom.
 */
export function pageZoomFactor(
    view: Pick<Window, 'innerWidth' | 'outerWidth'>
): number {
    return view.innerWidth > 0 && view.outerWidth > 0
        ? view.outerWidth / view.innerWidth
        : 1;
}

/**
 * The clearance at `zoomFactor`. App zoom (`webFrame.setZoomLevel`) scales
 * CSS pixels but not the native buttons: zoomed out, the same window points
 * hold more CSS pixels.
 */
export function trafficLightsClearance(
    zoomFactor: number
): TrafficLightsClearance {
    const factor =
        Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
    return { x: CLEAR_X / factor, y: CLEAR_Y / factor };
}

/**
 * Publishes the macOS traffic-light clearance on its host as
 * `--traffic-lights-clear-x` and `--traffic-lights-clear-y`, refreshed on
 * `resize` (Chromium fires it when the zoom changes). The shell grid, the
 * rail and the header read them; without them (off macOS) they fall back to
 * their default layout.
 */
@Directive({
    selector: '[appTrafficLightsClearance]',
    host: {
        '[style.--traffic-lights-clear-x]': 'clearX()',
        '[style.--traffic-lights-clear-y]': 'clearY()',
    },
})
export class TrafficLightsClearanceDirective {
    /** True where the native traffic lights overlay the window (macOS). */
    readonly enabled = input(false, { alias: 'appTrafficLightsClearance' });

    private readonly view = inject(DOCUMENT).defaultView;
    private readonly zoomFactor = signal(
        this.view ? pageZoomFactor(this.view) : 1
    );
    private readonly clearance = computed(() =>
        this.enabled() ? trafficLightsClearance(this.zoomFactor()) : null
    );
    protected readonly clearX = computed(() => toPx(this.clearance()?.x));
    protected readonly clearY = computed(() => toPx(this.clearance()?.y));

    constructor() {
        effect((onCleanup) => {
            const view = this.view;
            if (!this.enabled() || !view) return;
            const update = () => this.zoomFactor.set(pageZoomFactor(view));
            update();
            view.addEventListener('resize', update);
            onCleanup(() => view.removeEventListener('resize', update));
        });
    }
}

function toPx(value: number | undefined): string | null {
    return value === undefined ? null : `${value}px`;
}
