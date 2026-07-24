import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { HtmlVideoPlayerComponent } from './html-video-player.component';

describe('HtmlVideoPlayerComponent local timeshift', () => {
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HtmlVideoPlayerComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        fixture.detectChanges();
    });

    it('shows the LIVE action only for local timeshift and seeks to the live edge', () => {
        expect(getLiveButton(fixture)).toBeNull();
        const video = fixture.componentInstance.videoPlayer.nativeElement;
        Object.defineProperty(video, 'seekable', {
            configurable: true,
            value: createTimeRanges([[0, 45]]),
        });
        const play = jest.spyOn(video, 'play').mockResolvedValue(undefined);

        fixture.componentRef.setInput('localTimeshiftActive', true);
        fixture.detectChanges();
        getLiveButton(fixture)?.nativeElement.click();

        expect(video.currentTime).toBe(44.75);
        expect(play).toHaveBeenCalledTimes(1);
    });
});

function createTimeRanges(ranges: Array<[number, number]>): TimeRanges {
    return {
        length: ranges.length,
        start: (index: number) => ranges[index][0],
        end: (index: number) => ranges[index][1],
    } as TimeRanges;
}

function getLiveButton(fixture: ComponentFixture<HtmlVideoPlayerComponent>) {
    return fixture.debugElement.query(
        By.css('[data-test-id="local-timeshift-go-live"]')
    );
}
