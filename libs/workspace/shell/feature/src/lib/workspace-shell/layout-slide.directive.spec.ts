import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    LAYOUT_SLIDE_ACTIVE_CLASS,
    LAYOUT_SLIDE_DURATION_MS,
    LayoutSlideDirective,
    translateX,
} from './layout-slide.directive';

@Component({
    imports: [LayoutSlideDirective],
    template: `
        <div
            [appLayoutSlide]="slideKey()"
            [layoutSlideRecordOn]="recordKey()"
            layoutSlideTargets=".target"
        >
            <span class="target"></span>
        </div>
    `,
})
class HostComponent {
    readonly slideKey = signal('panel');
    readonly recordKey = signal(0);
}

interface FakeAnimation {
    readonly keyframes: Keyframe[];
    readonly options: KeyframeAnimationOptions;
    cancelled: boolean;
    finish(): void;
}

describe('LayoutSlideDirective', () => {
    let fixture: ComponentFixture<HostComponent>;
    let target: HTMLElement;
    let left: number;
    let animations: FakeAnimation[];
    let reducedMotion: boolean;
    const originalMatchMedia = window.matchMedia;

    beforeEach(() => {
        left = 60;
        animations = [];
        reducedMotion = false;
        window.matchMedia = ((query: string) => ({
            matches: reducedMotion && query.includes('reduce'),
        })) as unknown as typeof window.matchMedia;

        fixture = TestBed.createComponent(HostComponent);
        target = fixture.nativeElement.querySelector('.target');
        Object.defineProperty(target, 'offsetLeft', {
            configurable: true,
            get: () => left,
        });
        target.animate = ((
            keyframes: Keyframe[],
            options: KeyframeAnimationOptions
        ) => {
            const listeners: (() => void)[] = [];
            const animation = {
                keyframes,
                options,
                cancelled: false,
                addEventListener: (_type: string, listener: () => void) =>
                    listeners.push(listener),
                finish: () => listeners.forEach((listener) => listener()),
                cancel: () => {
                    animation.cancelled = true;
                    animation.finish();
                },
            };
            animations.push(animation);
            return animation;
        }) as unknown as HTMLElement['animate'];
        render();
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
    });

    function render(): void {
        fixture.detectChanges();
        TestBed.tick();
    }

    it('does not animate the first render', () => {
        expect(animations).toEqual([]);
    });

    it('slides a target from its previous position when the key changes', () => {
        left = 383;
        fixture.componentInstance.slideKey.set('single-pane');
        render();

        expect(animations).toHaveLength(1);
        expect(animations[0].keyframes).toEqual([
            { transform: 'translateX(-323px)' },
            { transform: 'none' },
        ]);
        expect(animations[0].options.duration).toBe(LAYOUT_SLIDE_DURATION_MS);
        expect(target.classList).toContain(LAYOUT_SLIDE_ACTIVE_CLASS);
        expect(target.style.getPropertyValue('--layout-slide-start')).toBe(
            '0px'
        );
        expect(target.style.getPropertyValue('--layout-slide-end')).toBe(
            '323px'
        );

        animations[0].finish();
        expect(target.classList).not.toContain(LAYOUT_SLIDE_ACTIVE_CLASS);
        expect(target.style.getPropertyValue('--layout-slide-end')).toBe('');
    });

    it('records moves of other changes instead of sliding them', () => {
        left = 120;
        fixture.componentInstance.recordKey.set(1);
        render();
        expect(animations).toEqual([]);

        left = 80;
        fixture.componentInstance.slideKey.set('single-pane');
        render();
        expect(animations[0].keyframes[0]).toEqual({
            transform: 'translateX(40px)',
        });
    });

    it('keeps a finished slide from clearing a newer one', () => {
        left = 383;
        fixture.componentInstance.slideKey.set('single-pane');
        render();
        left = 60;
        fixture.componentInstance.slideKey.set('panel');
        render();

        animations[0].finish();
        expect(target.classList).toContain(LAYOUT_SLIDE_ACTIVE_CLASS);
        expect(target.style.getPropertyValue('--layout-slide-start')).toBe(
            '323px'
        );
    });

    it('starts an interrupted slide from where the target is drawn', () => {
        left = 383;
        fixture.componentInstance.slideKey.set('single-pane');
        render();
        // 40 ms in, the first slide draws the target at 172 px.
        target.style.transform = 'matrix(1, 0, 0, 1, -211, 0)';
        left = 60;
        fixture.componentInstance.slideKey.set('panel');
        render();

        expect(animations).toHaveLength(2);
        expect(animations[0].cancelled).toBe(true);
        expect(animations[1].keyframes[0]).toEqual({
            transform: 'translateX(112px)',
        });
        expect(target.classList).toContain(LAYOUT_SLIDE_ACTIVE_CLASS);
    });

    it('reads the x translation of computed transforms', () => {
        expect(translateX('none')).toBe(0);
        expect(translateX('matrix(1, 0, 0, 1, -211.5, 0)')).toBe(-211.5);
        expect(
            translateX(
                'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 44, 0, 0, 1)'
            )
        ).toBe(44);
    });

    it('does not animate when the target did not move', () => {
        fixture.componentInstance.slideKey.set('single-pane');
        render();
        expect(animations).toEqual([]);
    });

    it('jumps under prefers-reduced-motion', () => {
        reducedMotion = true;
        left = 383;
        fixture.componentInstance.slideKey.set('single-pane');
        render();
        expect(animations).toEqual([]);
        expect(target.classList).not.toContain(LAYOUT_SLIDE_ACTIVE_CLASS);
    });
});
