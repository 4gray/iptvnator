import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { FerriteControlsComponent } from './ferrite-controls.component';

describe('FerriteControlsComponent', () => {
    let fixture: ComponentFixture<FerriteControlsComponent>;
    let component: FerriteControlsComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [FerriteControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fixture = TestBed.createComponent(FerriteControlsComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture?.destroy();
    });

    function setInputs(inputs: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(key, value);
        }
        fixture.detectChanges();
    }

    /** The presentational controls only emit; collect every emission of an output. */
    function collect<T>(output: { subscribe: (fn: (v: T) => void) => unknown }) {
        const events: T[] = [];
        output.subscribe((value) => events.push(value));
        return events;
    }

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    it('emits playToggle when the play/pause button is clicked', () => {
        setInputs({ paused: true });
        const events = collect(component.playToggle);

        const button = fixture.debugElement.queryAll(By.css('.ctl-btn'))[0];
        button.nativeElement.click();

        expect(events).toHaveLength(1);
    });

    it('renders the play icon when paused and the pause icon when playing', () => {
        setInputs({ paused: true });
        let icon = fixture.debugElement
            .queryAll(By.css('.ctl-btn'))[0]
            .query(By.css('mat-icon'));
        expect(icon.nativeElement.textContent.trim()).toBe('play_arrow');

        setInputs({ paused: false });
        icon = fixture.debugElement
            .queryAll(By.css('.ctl-btn'))[0]
            .query(By.css('mat-icon'));
        expect(icon.nativeElement.textContent.trim()).toBe('pause');
    });

    it('emits muteToggle when the mute button is clicked', () => {
        setInputs({});
        const events = collect(component.muteToggle);

        const muteButton = fixture.debugElement.queryAll(
            By.css('.ctl-btn')
        )[1];
        muteButton.nativeElement.click();

        expect(events).toHaveLength(1);
    });

    it('emits the new value from the volume slider input', () => {
        setInputs({ volume: 0.5 });
        const events = collect<number>(component.volumeInput);

        const thumb = fixture.debugElement.query(
            By.css('.ctl-vol input[matSliderThumb]')
        );
        thumb.triggerEventHandler('ngModelChange', 0.8);

        expect(events).toEqual([0.8]);
    });

    it('emits fullscreenToggle when the fullscreen button is clicked', () => {
        setInputs({});
        const events = collect(component.fullscreenToggle);

        const buttons = fixture.debugElement.queryAll(By.css('.ctl-btn'));
        const fullscreenButton = buttons[buttons.length - 1];
        fullscreenButton.nativeElement.click();

        expect(events).toHaveLength(1);
    });

    it('maps the volume icon to muted/low/high levels', () => {
        setInputs({ muted: true, volume: 0.9 });
        expect(
            fixture.debugElement
                .queryAll(By.css('.ctl-btn'))[1]
                .query(By.css('mat-icon'))
                .nativeElement.textContent.trim()
        ).toBe('volume_off');

        setInputs({ muted: false, volume: 0 });
        expect(
            fixture.debugElement
                .queryAll(By.css('.ctl-btn'))[1]
                .query(By.css('mat-icon'))
                .nativeElement.textContent.trim()
        ).toBe('volume_off');

        setInputs({ muted: false, volume: 0.3 });
        expect(
            fixture.debugElement
                .queryAll(By.css('.ctl-btn'))[1]
                .query(By.css('mat-icon'))
                .nativeElement.textContent.trim()
        ).toBe('volume_down');

        setInputs({ muted: false, volume: 0.8 });
        expect(
            fixture.debugElement
                .queryAll(By.css('.ctl-btn'))[1]
                .query(By.css('mat-icon'))
                .nativeElement.textContent.trim()
        ).toBe('volume_up');
    });

    it('shows the LIVE pill and no seek bar when live=true', () => {
        setInputs({ live: true, duration: 120 });

        expect(fixture.debugElement.query(By.css('.ctl-live'))).not.toBeNull();
        expect(fixture.debugElement.query(By.css('.ctl-seek'))).toBeNull();
    });

    it('shows the seek bar (no LIVE pill) when live=false and duration>0', () => {
        setInputs({ live: false, duration: 120 });

        expect(fixture.debugElement.query(By.css('.ctl-live'))).toBeNull();
        expect(fixture.debugElement.query(By.css('.ctl-seek'))).not.toBeNull();
    });

    it('hides the seek bar when not live but duration is zero', () => {
        setInputs({ live: false, duration: 0 });

        expect(fixture.debugElement.query(By.css('.ctl-live'))).toBeNull();
        expect(fixture.debugElement.query(By.css('.ctl-seek'))).toBeNull();
    });

    it('renders the deinterlace select only when deintSupported=true', () => {
        setInputs({ deintSupported: false });
        expect(fixture.debugElement.query(By.css('.ctl-deint'))).toBeNull();

        setInputs({ deintSupported: true });
        expect(fixture.debugElement.query(By.css('.ctl-deint'))).not.toBeNull();
    });

    it('emits deintChange from the deinterlace select', () => {
        setInputs({ deintSupported: true, deintMode: 1 });
        const events = collect<number>(component.deintChange);

        const select = fixture.debugElement.query(By.css('.ctl-deint'));
        select.triggerEventHandler('ngModelChange', 3);

        expect(events).toEqual([3]);
    });

    it('shows the deint warning only when deintFailed=true (and supported)', () => {
        setInputs({ deintSupported: true, deintFailed: false });
        expect(
            fixture.debugElement.query(By.css('.ctl-deint-warn'))
        ).toBeNull();

        setInputs({ deintSupported: true, deintFailed: true });
        expect(
            fixture.debugElement.query(By.css('.ctl-deint-warn'))
        ).not.toBeNull();
    });

    it('emits seekTo once on release when scrubbing, following the drag value', () => {
        setInputs({ live: false, duration: 200, currentTime: 10 });
        const events = collect<number>(component.seekTo);

        const thumb = fixture.debugElement.query(
            By.css('.ctl-seek input[matSliderThumb]')
        );

        // Begin a drag, move the thumb, then release: no emit until release.
        thumb.triggerEventHandler('dragStart', undefined);
        thumb.triggerEventHandler('ngModelChange', 42);
        thumb.triggerEventHandler('ngModelChange', 55);
        expect(events).toEqual([]);

        thumb.triggerEventHandler('dragEnd', undefined);
        expect(events).toEqual([55]);
    });

    it('emits seekTo immediately for a track-click with no preceding drag', () => {
        setInputs({ live: false, duration: 200, currentTime: 10 });
        const events = collect<number>(component.seekTo);

        const thumb = fixture.debugElement.query(
            By.css('.ctl-seek input[matSliderThumb]')
        );

        // ngModelChange without dragStart = a plain track click → seek now.
        thumb.triggerEventHandler('ngModelChange', 75);

        expect(events).toEqual([75]);
    });
});
