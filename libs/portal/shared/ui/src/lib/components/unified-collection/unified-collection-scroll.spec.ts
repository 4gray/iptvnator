import { Component, ElementRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createCollectionScrollState } from './unified-collection-scroll';

@Component({
    template: `
        @if (visible()) {
            <div data-collection-scroll="grid"></div>
            <div data-collection-scroll="rail"></div>
        }
    `,
})
class ScrollFixtureComponent {
    readonly visible = signal(true);
    readonly scroll = createCollectionScrollState(inject(ElementRef));
}

it('restores the watched rail and history grid offsets after the list remounts', () => {
    window.history.replaceState({}, document.title);
    const fixture = TestBed.createComponent(ScrollFixtureComponent);
    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;
    const scroller = (key: string) =>
        host.querySelector<HTMLElement>(
            `[data-collection-scroll="${key}"]`
        ) as HTMLElement;
    fixture.detectChanges();

    scroller('grid').scrollTop = 275;
    scroller('rail').scrollLeft = 140;
    component.scroll.commit();
    component.visible.set(false);
    fixture.detectChanges();

    component.scroll.restore();
    fixture.detectChanges();
    component.visible.set(true);
    fixture.detectChanges();

    expect(scroller('grid').scrollTop).toBe(275);
    expect(scroller('rail').scrollLeft).toBe(140);
});
