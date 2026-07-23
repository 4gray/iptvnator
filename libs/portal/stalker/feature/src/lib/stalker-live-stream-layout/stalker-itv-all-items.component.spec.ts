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

    it('renders the first client-side page of channels with a paginator', () => {
        fixture.componentRef.setInput('channels', buildChannels(60));
        fixture.detectChanges();

        expect(component.pagedGridItems()).toHaveLength(25);
        expect(fixture.nativeElement.querySelectorAll('mat-card')).toHaveLength(
            25
        );
        expect(fixture.nativeElement.querySelector('mat-paginator')).toBeTruthy();
        expect(
            fixture.nativeElement
                .querySelector('.category-subtitle')
                ?.textContent?.trim()
        ).toContain('60');
    });

    it('slices the next page on paginator change without touching the source', () => {
        fixture.componentRef.setInput('channels', buildChannels(60));
        fixture.detectChanges();

        component.onPageChange({
            pageIndex: 2,
            pageSize: 25,
            length: 60,
        } as never);
        fixture.detectChanges();

        // Third page holds the remaining 10 channels.
        expect(component.pagedGridItems()).toHaveLength(10);
        expect(component.pagedGridItems()[0]['id']).toBe('ch-50');
    });

    it('filters by the search term across ALL channels and resets to page one', () => {
        fixture.componentRef.setInput('channels', buildChannels(60));
        fixture.detectChanges();
        component.onPageChange({
            pageIndex: 1,
            pageSize: 25,
            length: 60,
        } as never);

        fixture.componentRef.setInput('searchTerm', 'needle');
        fixture.detectChanges();

        expect(component.pageIndex()).toBe(0);
        expect(
            component.pagedGridItems().map((item) => item['name'])
        ).toEqual(['Needle TV']);
    });

    it('maps the stalker logo to stream_icon and drops null is_series for the grid', () => {
        fixture.componentRef.setInput('channels', buildChannels(1));
        fixture.detectChanges();

        const [item] = component.pagedGridItems();
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
