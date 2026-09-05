import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { StreamFormat, VideoPlayer } from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsPlaybackSectionComponent } from './settings-playback-section.component';

/**
 * Who gets offered VOD auto-failover.
 *
 * Only the built-in web players raise the playback diagnostic that triggers a
 * source switch: Embedded MPV has its diagnostics suppressed and MPV/VLC play
 * outside the app entirely. Offering the control there would let a user enable
 * a feature that can never fire.
 */
describe('SettingsPlaybackSectionComponent — VOD auto-failover', () => {
    let fixture: ComponentFixture<SettingsPlaybackSectionComponent>;

    const settingRow = (): Element | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="vod-auto-failover-setting"]'
        );

    function render(player: VideoPlayer, supported = true): void {
        fixture.componentRef.setInput('form', createForm(player));
        fixture.componentRef.setInput('supportsVodMultiSource', supported);
        fixture.detectChanges();
    }

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
        fixture.componentRef.setInput('players', []);
        fixture.componentRef.setInput('streamFormatEnum', StreamFormat);
    });

    it.each([
        VideoPlayer.Html5Player,
        VideoPlayer.VideoJs,
        VideoPlayer.ArtPlayer,
    ])('offers the toggle on %s', (player) => {
        render(player);

        expect(settingRow()).not.toBeNull();
    });

    it.each([VideoPlayer.MPV, VideoPlayer.VLC, VideoPlayer.EmbeddedMpv])(
        'hides the toggle on %s, which never reports a playback failure',
        (player) => {
            render(player);

            expect(settingRow()).toBeNull();
        }
    );

    it('stays hidden in the PWA, where there is nothing to fail over to', () => {
        render(VideoPlayer.Html5Player, false);

        expect(settingRow()).toBeNull();
    });
});

function createForm(player: VideoPlayer): FormGroup {
    return new FormGroup({
        player: new FormControl(player),
        webPlayerSharedControls: new FormControl(false),
        playerAmbientMode: new FormControl(false),
        playerUpNextRail: new FormControl(true),
        fullscreenChannelPanel: new FormControl(true),
        streamFormat: new FormControl(StreamFormat.AutoStreamFormat),
        openStreamOnDoubleClick: new FormControl(false),
        showExternalPlaybackBar: new FormControl(true),
        embeddedMpvFrameCopy: new FormControl(false),
        mpvPlayerPath: new FormControl(''),
        mpvPlayerArguments: new FormControl(''),
        mpvReuseInstance: new FormControl(false),
        vlcPlayerPath: new FormControl(''),
        vlcPlayerArguments: new FormControl(''),
        vlcReuseInstance: new FormControl(false),
        recordingFolder: new FormControl(''),
        vodAutoFailover: new FormControl(false),
    });
}
