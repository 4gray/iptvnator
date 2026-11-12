import { EmbeddedMpvOverlayVisibilityService } from '../embedded-mpv-player/embedded-mpv-overlay-visibility.service';
import {
    afterRenderEffect,
    DestroyRef,
    Directive,
    ElementRef,
    inject,
    input,
} from '@angular/core';

/** Promote the existing canvas, never detach/recreate its playback component. */
@Directive({
    selector: '[appSecondStreamFloating]',
    host: { class: 'embedded-mpv-floating' },
})
export class SecondStreamFloatingDirective {
    readonly appSecondStreamFloating = input(false);
    readonly floatingControls = input(false);
    private readonly overlays = inject(EmbeddedMpvOverlayVisibilityService);
    private readonly element = inject(ElementRef<HTMLElement>).nativeElement;

    constructor() {
        const element = this.element;
        const document = element.ownerDocument;
        const refresh = () => {
            if (
                !this.appSecondStreamFloating() ||
                this.overlays.overlayActive() ||
                !element.isConnected
            )
                return;
            if (
                element.hasAttribute('popover') &&
                element.matches(':popover-open')
            )
                element.hidePopover();
            element.showPopover();
            if (!this.floatingControls())
                element
                    .closest('.embedded-mpv-pair')
                    ?.dispatchEvent(new Event('small-video-promoted'));
        };
        const promoteControls = () => {
            if (this.floatingControls()) refresh();
        };
        let pair: Element | null = null;
        afterRenderEffect(() => {
            if (!pair) {
                pair = element.closest('.embedded-mpv-pair');
                pair?.addEventListener('small-video-promoted', promoteControls);
            }
            if (this.appSecondStreamFloating()) {
                element.setAttribute('popover', 'manual');
                if (this.overlays.overlayActive()) {
                    if (element.matches(':popover-open')) element.hidePopover();
                } else refresh();
            } else {
                if (
                    element.hasAttribute('popover') &&
                    element.matches(':popover-open')
                )
                    element.hidePopover();
                element.removeAttribute('popover');
            }
        });
        document.addEventListener('fullscreenchange', refresh);
        inject(DestroyRef).onDestroy(() => {
            document.removeEventListener('fullscreenchange', refresh);
            pair?.removeEventListener('small-video-promoted', promoteControls);
            if (
                element.hasAttribute('popover') &&
                element.matches(':popover-open')
            )
                element.hidePopover();
        });
    }
}
