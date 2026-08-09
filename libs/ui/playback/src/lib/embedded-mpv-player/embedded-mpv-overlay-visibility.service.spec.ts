import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { EmbeddedMpvOverlayVisibilityService } from './embedded-mpv-overlay-visibility.service';

describe('EmbeddedMpvOverlayVisibilityService', () => {
    let service: EmbeddedMpvOverlayVisibilityService;
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: OverlayContainer,
                    useValue: { getContainerElement: () => container },
                },
                {
                    provide: MatDialog,
                    useValue: {
                        openDialogs: [],
                        afterOpened: new Subject(),
                        afterAllClosed: new Subject(),
                    },
                },
            ],
        });
        service = TestBed.inject(EmbeddedMpvOverlayVisibilityService);
    });

    it('starts with no active overlay', () => {
        expect(service.overlayActive()).toBe(false);
    });

    it('treats a registered external modal surface like an open dialog', () => {
        // e.g. the workspace's phone context drawer — a plain DOM panel the
        // CDK-container observer can never see, but which must hide the
        // native-view video that paints above DOM stacking.
        const release = service.acquireExternalModalSurface();
        expect(service.overlayActive()).toBe(true);

        release();
        expect(service.overlayActive()).toBe(false);
    });

    it('stays active until every external surface is released', () => {
        const releaseFirst = service.acquireExternalModalSurface();
        const releaseSecond = service.acquireExternalModalSurface();

        releaseFirst();
        expect(service.overlayActive()).toBe(true);

        releaseSecond();
        expect(service.overlayActive()).toBe(false);
    });

    it('ignores a double release', () => {
        const releaseFirst = service.acquireExternalModalSurface();
        const releaseSecond = service.acquireExternalModalSurface();

        releaseFirst();
        releaseFirst();

        expect(service.overlayActive()).toBe(true);
        releaseSecond();
        expect(service.overlayActive()).toBe(false);
    });
});
