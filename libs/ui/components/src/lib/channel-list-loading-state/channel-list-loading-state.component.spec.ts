import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ChannelListLoadingStateComponent } from './channel-list-loading-state.component';

describe('ChannelListLoadingStateComponent', () => {
    let fixture: ComponentFixture<ChannelListLoadingStateComponent>;
    let component: ChannelListLoadingStateComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                ChannelListLoadingStateComponent,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ChannelListLoadingStateComponent);
        component = fixture.componentInstance;
    });

    it('renders channel rows for non-group views', () => {
        fixture.componentRef.setInput('view', 'all');
        fixture.detectChanges();

        expect(component.isGroupsView()).toBe(false);
        expect(
            fixture.nativeElement.querySelectorAll('.channel-loading-row')
                .length
        ).toBe(component.channelRows.length);
        expect(
            fixture.nativeElement.querySelector('.groups-loading-layout')
        ).toBeNull();
    });

    it('renders a two-column group loading layout for the groups view', () => {
        fixture.componentRef.setInput('view', 'groups');
        fixture.detectChanges();

        expect(component.isGroupsView()).toBe(true);
        expect(
            fixture.nativeElement.querySelectorAll('.groups-loading-nav__item')
                .length
        ).toBe(component.groupRows.length);
        expect(
            fixture.nativeElement.querySelector('.groups-loading-content')
        ).not.toBeNull();
    });
});
