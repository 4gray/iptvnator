/* eslint-disable @typescript-eslint/unbound-method */
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';

import { HtmlVideoPlayerComponent } from './html-video-player.component';

describe('HtmlVideoPlayerComponent', () => {
    let component: HtmlVideoPlayerComponent;
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;
    const TEST_CHANNEL = {
        id: '1234',
        url: 'http://test',
        name: 'Test channel',
        group: {
            title: 'News group',
        },
    };

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            declarations: [HtmlVideoPlayerComponent],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should call play channel function after input changes', () => {
        spyOn(component, 'playChannel');
        component.ngOnChanges({
            channel: new SimpleChange(null, TEST_CHANNEL, true),
        });
        fixture.detectChanges();

        expect(component.playChannel).toBeCalledTimes(1);
        expect(component.playChannel).toBeCalledWith(TEST_CHANNEL);
    });
});
