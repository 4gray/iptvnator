import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EmbeddedMpvOverlayVisibilityService } from '../embedded-mpv-player/embedded-mpv-overlay-visibility.service';
import { SecondStreamFloatingDirective } from './second-stream-floating.directive';

@Component({
    imports: [SecondStreamFloatingDirective],
    template: `
        <section class="embedded-mpv-pair">
            <div
                data-layer="video"
                [appSecondStreamFloating]="floating()"
            ></div>
            <div
                data-layer="controls"
                [appSecondStreamFloating]="floating()"
                [floatingControls]="true"
            ></div>
        </section>
    `,
})
class HostComponent {
    readonly floating = signal(false);
}

it('keeps the controls above the floating video and yields the top layer to a modal', () => {
    const overlayActive = signal(false);
    TestBed.configureTestingModule({
        providers: [
            {
                provide: EmbeddedMpvOverlayVisibilityService,
                useValue: { overlayActive },
            },
        ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const layers = Array.from(
        root.querySelectorAll<HTMLElement>('[data-layer]')
    );
    const stack = new Set<HTMLElement>();
    const stackOrder = () => [...stack].map((layer) => layer.dataset['layer']);
    for (const layer of layers) {
        const matches = layer.matches.bind(layer);
        jest.spyOn(layer, 'matches').mockImplementation((selector: string) =>
            selector === ':popover-open' ? stack.has(layer) : matches(selector)
        );
        layer.showPopover = () => {
            stack.add(layer);
        };
        layer.hidePopover = () => {
            stack.delete(layer);
        };
    }

    fixture.componentInstance.floating.set(true);
    fixture.detectChanges();
    expect(stackOrder()).toEqual(['video', 'controls']);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(stackOrder()).toEqual(['video', 'controls']);

    overlayActive.set(true);
    fixture.detectChanges();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(stack.size).toBe(0);
    expect(
        layers.every((layer) => layer.getAttribute('popover') === 'manual')
    ).toBe(true);

    overlayActive.set(false);
    fixture.detectChanges();
    expect(stackOrder()).toEqual(['video', 'controls']);
    fixture.componentInstance.floating.set(false);
    fixture.detectChanges();
    expect(stack.size).toBe(0);
    expect(layers.every((layer) => !layer.hasAttribute('popover'))).toBe(true);

    fixture.componentInstance.floating.set(true);
    fixture.detectChanges();
    fixture.destroy();
    expect(stack.size).toBe(0);
});
