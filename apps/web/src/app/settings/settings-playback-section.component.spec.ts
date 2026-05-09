import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { StreamFormat, VideoPlayer } from 'shared-interfaces';
import { SettingsPlaybackSectionComponent } from './settings-playback-section.component';

describe('SettingsPlaybackSectionComponent', () => {
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
        fixture.componentRef.setInput('form', createForm());
        fixture.componentRef.setInput('activeSection', 'playback');
        fixture.componentRef.setInput('players', [
            {
                id: VideoPlayer.VideoJs,
                labelKey: 'SETTINGS.PLAYER_VIDEOJS',
            },
            {
                id: VideoPlayer.MPV,
                labelKey: 'SETTINGS.PLAYER_MPV',
            },
        ]);
        fixture.componentRef.setInput('streamFormatEnum', StreamFormat);
    });

    it('hides the external-player double-click option outside desktop builds', () => {
        fixture.componentRef.setInput('form', createForm(VideoPlayer.MPV));
        fixture.componentRef.setInput('isDesktop', false);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="external-player-double-click-setting"]'
            )
        ).toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain(
            'SETTINGS.OPEN_STREAM_ON_DOUBLE_CLICK'
        );
    });

    it('hides the external-player double-click option for embedded players', () => {
        fixture.componentRef.setInput('isDesktop', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="external-player-double-click-setting"]'
            )
        ).toBeNull();
    });

    it.each([VideoPlayer.MPV, VideoPlayer.VLC])(
        'labels the double-click option as external-player behavior on desktop for %s',
        (player) => {
            fixture.componentRef.setInput('form', createForm(player));
            fixture.componentRef.setInput('isDesktop', true);
            fixture.detectChanges();

            expect(
                fixture.nativeElement.querySelector(
                    '[data-test-id="external-player-double-click-setting"]'
                )
            ).not.toBeNull();
            expect(fixture.nativeElement.textContent).toContain(
                'SETTINGS.OPEN_EXTERNAL_PLAYER_ON_DOUBLE_CLICK'
            );
        }
    );

    it('updates the double-click option visibility when the selected player changes', () => {
        const form = createForm();
        fixture.componentRef.setInput('form', form);
        fixture.componentRef.setInput('isDesktop', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="external-player-double-click-setting"]'
            )
        ).toBeNull();

        form.controls['player'].setValue(VideoPlayer.MPV);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="external-player-double-click-setting"]'
            )
        ).not.toBeNull();
    });

    it('shows the recording folder setting only in desktop builds', () => {
        fixture.componentRef.setInput('isDesktop', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="recording-folder-setting"]'
            )
        ).not.toBeNull();

        fixture.componentRef.setInput('isDesktop', false);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="recording-folder-setting"]'
            )
        ).toBeNull();
    });
});

function createForm(player = VideoPlayer.VideoJs): FormGroup {
    return new FormGroup({
        player: new FormControl(player),
        streamFormat: new FormControl(StreamFormat.M3u8StreamFormat),
        openStreamOnDoubleClick: new FormControl(false),
        showExternalPlaybackBar: new FormControl(true),
        mpvPlayerPath: new FormControl(''),
        mpvReuseInstance: new FormControl(false),
        vlcPlayerPath: new FormControl(''),
        vlcReuseInstance: new FormControl(false),
        recordingFolder: new FormControl(''),
    });
}
