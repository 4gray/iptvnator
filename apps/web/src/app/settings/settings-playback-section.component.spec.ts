import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { StreamFormat, VideoPlayer } from '@iptvnator/shared/interfaces';
import { SettingsPlaybackSectionComponent } from './settings-playback-section.component';

const MPV_PATH_DESCRIPTION =
    'Set the path to MPV. On macOS you can use the MPV app bundle, such as /Applications/mpv.app, or the executable path.';
const MPV_COMPATIBLE_PLAYER_TIP =
    'IINA can be launched as an MPV-compatible player on macOS, but use its executable path, such as /Applications/IINA.app/Contents/MacOS/iina-cli or /Applications/IINA.app/Contents/MacOS/IINA. IPTVnator controls, position polling, and reuse-instance behavior are guaranteed only for MPV IPC.';
const VLC_PATH_DESCRIPTION =
    'Set the path to VLC. On macOS you can use the VLC app bundle, such as /Applications/VLC.app, or the executable path.';
const MPV_ARGUMENTS_PLACEHOLDER =
    '--ontop\n--autofit=640x360\n--geometry=+80+80';
const VLC_ARGUMENTS_PLACEHOLDER = '--video-on-top\n--width=640\n--height=360';

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

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation(
            'en',
            {
                SETTINGS: {
                    MPV_PLAYER_PATH_DESCRIPTION: MPV_PATH_DESCRIPTION,
                    MPV_COMPATIBLE_PLAYER_TIP: MPV_COMPATIBLE_PLAYER_TIP,
                    VLC_PLAYER_PATH_DESCRIPTION: VLC_PATH_DESCRIPTION,
                },
            },
            true
        );
        translate.use('en');

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

    it('shows MPV bundle guidance and the IINA executable tip for desktop MPV playback', () => {
        fixture.componentRef.setInput('form', createForm(VideoPlayer.MPV));
        fixture.componentRef.setInput('isDesktop', true);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            MPV_PATH_DESCRIPTION
        );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="mpv-compatible-player-tip"]'
            )
        ).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain(
            MPV_COMPATIBLE_PLAYER_TIP
        );
    });

    it('hides MPV path guidance and the IINA executable tip outside desktop builds', () => {
        fixture.componentRef.setInput('form', createForm(VideoPlayer.MPV));
        fixture.componentRef.setInput('isDesktop', false);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).not.toContain(
            MPV_PATH_DESCRIPTION
        );
        expect(fixture.nativeElement.textContent).not.toContain(
            MPV_COMPATIBLE_PLAYER_TIP
        );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="mpv-compatible-player-tip"]'
            )
        ).toBeNull();
    });

    it('shows VLC bundle guidance without the IINA tip for desktop VLC playback', () => {
        fixture.componentRef.setInput('form', createForm(VideoPlayer.VLC));
        fixture.componentRef.setInput('isDesktop', true);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            VLC_PATH_DESCRIPTION
        );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="mpv-compatible-player-tip"]'
            )
        ).toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain(
            MPV_COMPATIBLE_PLAYER_TIP
        );
    });

    it('hides VLC path guidance outside desktop builds', () => {
        fixture.componentRef.setInput('form', createForm(VideoPlayer.VLC));
        fixture.componentRef.setInput('isDesktop', false);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).not.toContain(
            VLC_PATH_DESCRIPTION
        );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="mpv-compatible-player-tip"]'
            )
        ).toBeNull();
    });

    it('does not show external-player path guidance for embedded players', () => {
        fixture.componentRef.setInput('isDesktop', true);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).not.toContain(
            MPV_PATH_DESCRIPTION
        );
        expect(fixture.nativeElement.textContent).not.toContain(
            VLC_PATH_DESCRIPTION
        );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="mpv-compatible-player-tip"]'
            )
        ).toBeNull();
    });

    it('shows MPV command-line arguments only when MPV is selected', () => {
        fixture.componentRef.setInput('form', createForm(VideoPlayer.MPV));
        fixture.componentRef.setInput('isDesktop', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="mpv-player-arguments-setting"]'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="vlc-player-arguments-setting"]'
            )
        ).toBeNull();
        expect(fixture.nativeElement.textContent).toContain(
            'SETTINGS.MPV_PLAYER_ARGUMENTS_LABEL'
        );
        expect(
            fixture.nativeElement.querySelector<HTMLTextAreaElement>(
                '#mpvPlayerArguments'
            )?.placeholder
        ).toBe(MPV_ARGUMENTS_PLACEHOLDER);
    });

    it('shows VLC command-line arguments only when VLC is selected', () => {
        fixture.componentRef.setInput('form', createForm(VideoPlayer.VLC));
        fixture.componentRef.setInput('isDesktop', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="vlc-player-arguments-setting"]'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="mpv-player-arguments-setting"]'
            )
        ).toBeNull();
        expect(fixture.nativeElement.textContent).toContain(
            'SETTINGS.VLC_PLAYER_ARGUMENTS_LABEL'
        );
        expect(
            fixture.nativeElement.querySelector<HTMLTextAreaElement>(
                '#vlcPlayerArguments'
            )?.placeholder
        ).toBe(VLC_ARGUMENTS_PLACEHOLDER);
    });
});

function createForm(player = VideoPlayer.VideoJs): FormGroup {
    return new FormGroup({
        player: new FormControl(player),
        streamFormat: new FormControl(StreamFormat.M3u8StreamFormat),
        openStreamOnDoubleClick: new FormControl(false),
        showExternalPlaybackBar: new FormControl(true),
        mpvPlayerPath: new FormControl(''),
        mpvPlayerArguments: new FormControl(''),
        mpvReuseInstance: new FormControl(false),
        vlcPlayerPath: new FormControl(''),
        vlcPlayerArguments: new FormControl(''),
        vlcReuseInstance: new FormControl(false),
        recordingFolder: new FormControl(''),
    });
}
