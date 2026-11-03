import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StalkerItvChannel } from '@iptvnator/portal/stalker/data-access';
import { StalkerItvAllItemsComponent } from './stalker-itv-all-items.component';
import { SettingsStore } from '@iptvnator/services';

function buildChannels(count: number): StalkerItvChannel[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `ch-${index}`,
        cmd: `ffrt4://itv/${index}`,
        name: index === count - 1 ? 'Needle TV' : `Channel ${index}`,
        o_name: index === count - 1 ? 'Needle TV' : `Channel ${index}`,
        logo: `logo-${index}.png`,
        is_series: null,
    }));
}

describe('StalkerItvAllItemsComponent', () => {
    let fixture: ComponentFixture<StalkerItvAllItemsComponent>;
    let component: StalkerItvAllItemsComponent;

    beforeEach(async () => {
        localStorage.removeItem('stalker-itv-overview-view');
        await TestBed.configureTestingModule({
            imports: [StalkerItvAllItemsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fixture = TestBed.createComponent(StalkerItvAllItemsComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => localStorage.removeItem('stalker-itv-overview-view'));

    it('keeps double-click mode in the list until explicit pointer or keyboard activation', () => {
        jest.spyOn(
            TestBed.inject(SettingsStore),
            'openStreamOnDoubleClick'
        ).mockReturnValue(true);
        const activate = jest.fn();
        component.channelActivated.subscribe(activate);
        fixture.componentRef.setInput('channels', buildChannels(1));
        component.setViewMode('list');
        fixture.detectChanges();
        const row = fixture.nativeElement.querySelector(
            '.channel-list-item'
        ) as HTMLElement;
        row.dispatchEvent(
            new MouseEvent('click', { bubbles: true, detail: 1 })
        );
        expect(activate).not.toHaveBeenCalled();
        row.dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true, detail: 2 })
        );
        expect(activate).toHaveBeenCalledTimes(1);
        (row.querySelector('.channel-content') as HTMLButtonElement).click();
        expect(activate).toHaveBeenCalledTimes(2);
    });

    it('switches to shared channel rows without losing the search and remembers the mode', () => {
        fixture.componentRef.setInput('channels', buildChannels(120));
        fixture.componentRef.setInput('searchTerm', 'needle');
        fixture.detectChanges();

        const toggle = fixture.nativeElement.querySelector(
            '[data-view-mode="list"] button'
        ) as HTMLButtonElement;
        expect(toggle).not.toBeNull();
        toggle.click();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelectorAll('app-channel-list-item')
        ).toHaveLength(1);
        expect(fixture.nativeElement.textContent).toContain('Needle TV');
        expect(localStorage.getItem('stalker-itv-overview-view')).toBe('list');

        const restored = TestBed.createComponent(StalkerItvAllItemsComponent);
        restored.componentRef.setInput('channels', buildChannels(1));
        restored.detectChanges();
        expect(
            restored.nativeElement.querySelector('app-channel-list-item')
        ).not.toBeNull();
        restored.destroy();
    });

    it('shows the same EPG in grid and list and hides it when disabled', () => {
        const program = {
            start: '2026-11-02T19:00:00Z',
            stop: '2026-11-02T20:00:00Z',
            channel: 'ch-0',
            title: 'Evening news',
            desc: null,
            category: null,
        };
        fixture.componentRef.setInput('channels', buildChannels(1));
        fixture.componentRef.setInput('showEpg', true);
        fixture.componentRef.setInput(
            'epgPrograms',
            new Map([['ch-0', program]])
        );
        fixture.componentRef.setInput('epgProgress', new Map([['ch-0', 35]]));
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('.grid-epg-title')?.textContent
        ).toContain('Evening news');

        fixture.nativeElement
            .querySelector('[data-view-mode="list"] button')
            .click();
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('.epg-title')?.textContent
        ).toContain('Evening news');
        fixture.componentRef.setInput('showEpg', false);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.epg-title')).toBeNull();
    });

    it('places panel restoration in the overview header and emits the rendered window', () => {
        const restore = jest.fn();
        const visible = jest.fn();
        component.restorePanels.subscribe(restore);
        component.visibleChannelsChanged.subscribe(visible);
        fixture.componentRef.setInput('channels', buildChannels(120));
        fixture.componentRef.setInput('sidebarCollapsed', true);
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector(
            '.category-content-header .overview-restore'
        ) as HTMLButtonElement;
        expect(button).not.toBeNull();
        button.click();
        expect(restore).toHaveBeenCalledTimes(1);
        expect(visible).toHaveBeenLastCalledWith(
            buildChannels(120).slice(0, 50)
        );
    });

    it('uses row skeletons and a labelled busy state in list mode', () => {
        fixture.componentRef.setInput('channels', buildChannels(1));
        fixture.detectChanges();
        fixture.nativeElement
            .querySelector('[data-view-mode="list"] button')
            .click();
        fixture.componentRef.setInput('loading', true);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('app-channel-list-skeleton')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('[aria-busy="true"]')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('[role="status"]')?.textContent
        ).toContain('PORTALS.LOADING_ALL_CHANNELS');
    });

    it('renders the first window of channels with no paginator', () => {
        fixture.componentRef.setInput('channels', buildChannels(120));
        fixture.detectChanges();

        expect(component.visibleGridItems()).toHaveLength(50);
        expect(fixture.nativeElement.querySelectorAll('mat-card')).toHaveLength(
            50
        );
        expect(fixture.nativeElement.querySelector('mat-paginator')).toBeNull();
        expect(component.hasMoreItems()).toBe(true);
        expect(
            fixture.nativeElement
                .querySelector('.category-subtitle')
                ?.textContent?.trim()
        ).toContain('120');
    });

    it('grows the render window with loadMore until everything is visible', () => {
        fixture.componentRef.setInput('channels', buildChannels(120));
        fixture.detectChanges();

        component.loadMore();
        expect(component.visibleGridItems()).toHaveLength(100);

        component.loadMore();
        expect(component.visibleGridItems()).toHaveLength(120);
        expect(component.hasMoreItems()).toBe(false);

        // Covered — a further loadMore is a no-op.
        component.loadMore();
        expect(component.renderLimit()).toBe(150);
    });

    it('filters by the search term across ALL channels and resets the window', () => {
        fixture.componentRef.setInput('channels', buildChannels(120));
        fixture.detectChanges();
        component.loadMore();
        expect(component.renderLimit()).toBe(100);

        fixture.componentRef.setInput('searchTerm', 'needle');
        fixture.detectChanges();

        expect(component.renderLimit()).toBe(50);
        expect(
            component.visibleGridItems().map((item) => item['name'])
        ).toEqual(['Needle TV']);
    });

    it('maps the stalker logo to stream_icon and drops null is_series for the grid', () => {
        fixture.componentRef.setInput('channels', buildChannels(1));
        fixture.detectChanges();

        const [item] = component.visibleGridItems();
        expect(item['stream_icon']).toBe('logo-0.png');
        expect('is_series' in item).toBe(false);
    });

    it('emits channelActivated when a card is clicked', () => {
        const activated = jest.fn();
        fixture.componentRef.setInput('channels', buildChannels(3));
        fixture.componentInstance.channelActivated.subscribe(activated);
        fixture.detectChanges();

        (
            fixture.nativeElement.querySelector('mat-card') as HTMLElement
        ).click();

        expect(activated).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'ch-0' })
        );
    });

    it('shows skeletons and load progress while loading', () => {
        fixture.componentRef.setInput('channels', []);
        fixture.componentRef.setInput('loading', true);
        fixture.componentRef.setInput('progress', { loaded: 140, total: 400 });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.grid-skeleton-card')
        ).toBeTruthy();
        expect(
            fixture.nativeElement
                .querySelector('.all-items-progress')
                ?.textContent?.replace(/\s+/g, '')
        ).toContain('140/400');
        expect(fixture.nativeElement.querySelector('mat-paginator')).toBeNull();
    });
});
