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

    it('renders the channel-list skeleton wrapper for non-group views', () => {
        fixture.componentRef.setInput('view', 'all');
        fixture.detectChanges();

        expect(component.isGroupsView()).toBe(false);
        expect(
            fixture.nativeElement.querySelector('app-channel-list-skeleton')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.groups-loading-layout')
        ).toBeNull();
    });

    it('mirrors the All channels header: title row with two actions, then the divider', () => {
        fixture.componentRef.setInput('view', 'all');
        fixture.detectChanges();

        const row: HTMLElement = fixture.nativeElement.querySelector(
            '.channels-loading-header__row'
        );
        expect(
            row.classList.contains('channels-loading-header__row--actions')
        ).toBe(true);
        expect(row.querySelectorAll('.loading-header-action')).toHaveLength(2);
        expect(
            fixture.nativeElement.querySelector('.channels-loading-divider')
        ).not.toBeNull();
    });

    it('keeps the title row of the favorites and recent headers free of actions', () => {
        fixture.componentRef.setInput('view', 'favorites');
        fixture.detectChanges();

        const row: HTMLElement = fixture.nativeElement.querySelector(
            '.channels-loading-header__row'
        );
        expect(
            row.classList.contains('channels-loading-header__row--actions')
        ).toBe(false);
        expect(row.querySelector('.loading-header-action')).toBeNull();
    });

    it('drops the headers where the loaded view hides its own', () => {
        fixture.componentRef.setInput('showHeader', false);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.channels-loading-header')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.channels-loading-divider')
        ).toBeNull();

        fixture.componentRef.setInput('view', 'groups');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '.groups-loading-content__header'
            )
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.groups-loading-nav__header')
        ).not.toBeNull();
    });

    it('renders compact skeleton rows when the host disables EPG', () => {
        fixture.componentRef.setInput('showEpg', false);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '.channel-list-item-skeleton.compact'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '.channel-list-item-skeleton:not(.compact)'
            )
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
        expect(
            fixture.nativeElement.querySelectorAll(
                '.groups-loading-content__header .loading-header-action'
            )
        ).toHaveLength(2);
    });
});
