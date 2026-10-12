import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { WorkspaceBackNavigationService } from '@iptvnator/portal/shared/data-access';
import { DiscoverViewComponent } from './discover-view.component';

describe('DiscoverViewComponent', () => {
    it('offers its Back in the workspace header instead of its own arrow', () => {
        TestBed.configureTestingModule({
            imports: [DiscoverViewComponent, TranslateModule.forRoot()],
        });
        const fixture = TestBed.createComponent(DiscoverViewComponent);
        fixture.componentRef.setInput('facets', {
            type: 'movie',
            genreId: 18,
            genreLabel: 'Drama',
            year: null,
            countryCode: null,
            countryLabel: null,
        });
        const backClicked = jest.fn();
        fixture.componentInstance.backClicked.subscribe(backClicked);
        fixture.detectChanges();
        const backNavigation = TestBed.inject(WorkspaceBackNavigationService);

        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '.discover-view > button'
            )
        ).toBeNull();
        expect(backNavigation.target()?.escapeShortcut()).toBe(false);
        backNavigation.goBack();
        expect(backClicked).toHaveBeenCalledTimes(1);

        fixture.destroy();
        expect(backNavigation.target()).toBeNull();
    });
});
