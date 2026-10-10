import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ElectronBridgeWindowState } from '@iptvnator/shared/interfaces';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WindowControlsComponent } from './window-controls.component';

describe('WindowControlsComponent', () => {
    let fixture: ComponentFixture<WindowControlsComponent>;
    let stateChangeCallback:
        | ((state: ElectronBridgeWindowState) => void)
        | undefined;

    const unsubscribe = jest.fn();
    const electronMock = {
        getWindowState: jest.fn(),
        onWindowStateChange: jest.fn(),
        minimizeWindow: jest.fn(),
        toggleMaximizeWindow: jest.fn(),
        closeWindow: jest.fn(),
    };

    const query = (testId: string): HTMLElement | null =>
        fixture.nativeElement.querySelector(`[data-test-id="${testId}"]`);

    beforeEach(async () => {
        jest.clearAllMocks();
        stateChangeCallback = undefined;
        electronMock.getWindowState.mockResolvedValue({
            isMaximized: false,
            isFullScreen: false,
        });
        electronMock.toggleMaximizeWindow.mockResolvedValue({
            isMaximized: true,
            isFullScreen: false,
        });
        electronMock.minimizeWindow.mockResolvedValue(undefined);
        electronMock.closeWindow.mockResolvedValue(undefined);
        electronMock.onWindowStateChange.mockImplementation(
            (callback: (state: ElectronBridgeWindowState) => void) => {
                stateChangeCallback = callback;
                return unsubscribe;
            }
        );
        (window as { electron?: unknown }).electron = electronMock;

        await TestBed.configureTestingModule({
            imports: [WindowControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('de', {
            WORKSPACE: {
                SHELL: {
                    WINDOW_MINIMIZE: 'Minimieren',
                    WINDOW_MAXIMIZE: 'Maximieren',
                    WINDOW_RESTORE: 'Wiederherstellen',
                    WINDOW_CLOSE: 'Schließen',
                },
            },
        });
        translate.use('de');

        fixture = TestBed.createComponent(WindowControlsComponent);
        fixture.detectChanges();
    });

    afterEach(() => {
        delete (window as { electron?: unknown }).electron;
    });

    it('renders minimize, maximize and close buttons with the maximize glyph', () => {
        expect(query('window-minimize')).not.toBeNull();
        expect(query('window-maximize')).not.toBeNull();
        expect(query('window-close')).not.toBeNull();
        expect(query('window-maximize-glyph')).not.toBeNull();
        expect(query('window-restore-glyph')).toBeNull();
        expect(electronMock.getWindowState).toHaveBeenCalled();
    });

    it('labels every button in the active language', () => {
        for (const [testId, label] of [
            ['window-minimize', 'Minimieren'],
            ['window-maximize', 'Maximieren'],
            ['window-close', 'Schließen'],
        ]) {
            expect(query(testId)?.getAttribute('aria-label')).toBe(label);
            expect(query(testId)?.getAttribute('title')).toBe(label);
        }
    });

    it('calls the bridge methods when the buttons are clicked', () => {
        query('window-minimize')?.click();
        expect(electronMock.minimizeWindow).toHaveBeenCalledTimes(1);

        query('window-maximize')?.click();
        expect(electronMock.toggleMaximizeWindow).toHaveBeenCalledTimes(1);

        query('window-close')?.click();
        expect(electronMock.closeWindow).toHaveBeenCalledTimes(1);
    });

    it('swaps to the restore glyph when the window state reports maximized', () => {
        stateChangeCallback?.({ isMaximized: true, isFullScreen: false });
        fixture.detectChanges();

        expect(query('window-restore-glyph')).not.toBeNull();
        expect(query('window-maximize-glyph')).toBeNull();
        expect(query('window-maximize')?.getAttribute('aria-label')).toBe(
            'Wiederherstellen'
        );
    });

    it('applies the restore state returned by toggleMaximizeWindow', async () => {
        query('window-maximize')?.click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(query('window-restore-glyph')).not.toBeNull();
    });

    it('hides the host while the window is in fullscreen', () => {
        stateChangeCallback?.({ isMaximized: false, isFullScreen: true });
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).classList.contains(
                'is-hidden'
            )
        ).toBe(true);

        stateChangeCallback?.({ isMaximized: false, isFullScreen: false });
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).classList.contains(
                'is-hidden'
            )
        ).toBe(false);
    });

    it('unsubscribes from window state changes on destroy', () => {
        fixture.destroy();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
