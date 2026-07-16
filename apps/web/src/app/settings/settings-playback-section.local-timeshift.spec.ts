import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { StreamFormat, VideoPlayer } from '@iptvnator/shared/interfaces';
import { SettingsPlaybackSectionComponent } from './settings-playback-section.component';

describe('SettingsPlaybackSectionComponent local timeshift settings', () => {
    let fixture: ComponentFixture<SettingsPlaybackSectionComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                SettingsPlaybackSectionComponent,
                NoopAnimationsModule,
                ReactiveFormsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SettingsPlaybackSectionComponent);
        fixture.componentRef.setInput('activeSection', 'playback');
        fixture.componentRef.setInput('players', []);
        fixture.componentRef.setInput('streamFormatEnum', StreamFormat);
    });

    it.each([
        VideoPlayer.VideoJs,
        VideoPlayer.Html5Player,
        VideoPlayer.ArtPlayer,
        VideoPlayer.EmbeddedMpv,
    ])(
        'shows the default configuration for desktop inline player %s',
        (player) => {
            fixture.componentRef.setInput('form', createForm(player));
            fixture.componentRef.setInput('isDesktop', true);
            fixture.detectChanges();

            expect(
                fixture.nativeElement.querySelector(
                    '[data-test-id="local-timeshift-enabled-setting"]'
                )
            ).not.toBeNull();
            expect(
                fixture.nativeElement.querySelector<HTMLInputElement>(
                    '[data-test-id="local-timeshift-max-duration"]'
                )?.value
            ).toBe('30');
            expect(
                fixture.nativeElement.querySelector<HTMLInputElement>(
                    '[data-test-id="local-timeshift-buffer-directory"]'
                )?.value
            ).toBe('');
        }
    );

    it('hides the configuration outside Electron', () => {
        fixture.componentRef.setInput('form', createForm());
        fixture.componentRef.setInput('isDesktop', false);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="local-timeshift-enabled-setting"]'
            )
        ).toBeNull();
    });

    it.each([VideoPlayer.MPV, VideoPlayer.VLC])(
        'hides the configuration for external player %s',
        (player) => {
            fixture.componentRef.setInput('form', createForm(player));
            fixture.componentRef.setInput('isDesktop', true);
            fixture.detectChanges();

            expect(
                fixture.nativeElement.querySelector(
                    '[data-test-id="local-timeshift-enabled-setting"]'
                )
            ).toBeNull();
        }
    );
});

function createForm(player = VideoPlayer.VideoJs): FormGroup {
    return new FormGroup({
        player: new FormControl(player),
        streamFormat: new FormControl(StreamFormat.AutoStreamFormat),
        openStreamOnDoubleClick: new FormControl(false),
        showExternalPlaybackBar: new FormControl(true),
        mpvPlayerPath: new FormControl(''),
        mpvPlayerArguments: new FormControl(''),
        mpvReuseInstance: new FormControl(false),
        vlcPlayerPath: new FormControl(''),
        vlcPlayerArguments: new FormControl(''),
        vlcReuseInstance: new FormControl(false),
        recordingFolder: new FormControl(''),
        localTimeshift: new FormGroup({
            enabled: new FormControl(false),
            maxDurationMinutes: new FormControl(30),
            bufferDirectory: new FormControl(''),
        }),
    });
}
