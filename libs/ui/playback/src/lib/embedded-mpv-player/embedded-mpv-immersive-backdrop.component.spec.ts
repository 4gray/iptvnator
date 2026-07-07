import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmbeddedMpvImmersiveBackdropComponent } from './embedded-mpv-immersive-backdrop.component';
import { EmbeddedMpvImmersiveService } from './embedded-mpv-immersive.service';

describe('EmbeddedMpvImmersiveBackdropComponent', () => {
    let fixture: ComponentFixture<EmbeddedMpvImmersiveBackdropComponent>;
    let immersive: EmbeddedMpvImmersiveService;

    const cutout = () =>
        fixture.nativeElement.querySelector('.cutout') as HTMLElement | null;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [EmbeddedMpvImmersiveBackdropComponent],
        }).compileComponents();

        immersive = TestBed.inject(EmbeddedMpvImmersiveService);
        fixture = TestBed.createComponent(
            EmbeddedMpvImmersiveBackdropComponent
        );
        fixture.detectChanges();
    });

    afterEach(() => {
        immersive.setRect(null);
        immersive.setFullscreen(false);
        while (immersive.active()) {
            immersive.deactivate();
        }
    });

    it('renders nothing while the overlay is inactive', () => {
        immersive.setRect({ x: 10, y: 20, width: 300, height: 200 });
        fixture.detectChanges();
        expect(cutout()).toBeNull();
    });

    it('punches the hole at the measured native video rect when active', () => {
        immersive.activate();
        immersive.setRect({ x: 10, y: 20, width: 300, height: 200 });
        fixture.detectChanges();

        const hole = cutout();
        expect(hole).not.toBeNull();
        expect(hole?.style.left).toBe('10px');
        expect(hole?.style.top).toBe('20px');
        expect(hole?.style.width).toBe('300px');
        expect(hole?.style.height).toBe('200px');
    });

    it('follows rect updates while active', () => {
        immersive.activate();
        immersive.setRect({ x: 0, y: 0, width: 100, height: 100 });
        fixture.detectChanges();

        immersive.setRect({ x: 5, y: 6, width: 640, height: 360 });
        fixture.detectChanges();

        const hole = cutout();
        expect(hole?.style.left).toBe('5px');
        expect(hole?.style.top).toBe('6px');
        expect(hole?.style.width).toBe('640px');
        expect(hole?.style.height).toBe('360px');
    });

    it('renders nothing while active but without a measured rect', () => {
        immersive.activate();
        immersive.setRect(null);
        fixture.detectChanges();
        expect(cutout()).toBeNull();
    });

    it('turns off in fullscreen (chrome-hide takes over) and back on after', () => {
        immersive.activate();
        immersive.setRect({ x: 10, y: 20, width: 300, height: 200 });
        immersive.setFullscreen(true);
        fixture.detectChanges();
        expect(cutout()).toBeNull();

        immersive.setFullscreen(false);
        fixture.detectChanges();
        expect(cutout()).not.toBeNull();
    });

    it('disappears again when the last activator deactivates', () => {
        immersive.activate();
        immersive.setRect({ x: 1, y: 2, width: 3, height: 4 });
        fixture.detectChanges();
        expect(cutout()).not.toBeNull();

        immersive.deactivate();
        fixture.detectChanges();
        expect(cutout()).toBeNull();
    });
});
