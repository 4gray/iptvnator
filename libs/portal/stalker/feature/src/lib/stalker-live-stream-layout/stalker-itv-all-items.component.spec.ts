import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StalkerItvChannel } from '@iptvnator/portal/stalker/data-access';
import { StalkerItvAllItemsComponent } from './stalker-itv-all-items.component';

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
        await TestBed.configureTestingModule({
            imports: [
                StalkerItvAllItemsComponent,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(StalkerItvAllItemsComponent);
        component = fixture.componentInstance;
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
