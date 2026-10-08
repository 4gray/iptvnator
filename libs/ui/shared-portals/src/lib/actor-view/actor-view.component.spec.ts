import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { WorkspaceBackNavigationService } from '@iptvnator/portal/shared/data-access';
import { ActorViewComponent } from './actor-view.component';

describe('ActorViewComponent', () => {
    it('offers its Back in the workspace header instead of its own arrow', () => {
        TestBed.configureTestingModule({
            imports: [ActorViewComponent, TranslateModule.forRoot()],
        });
        const fixture = TestBed.createComponent(ActorViewComponent);
        const backClicked = jest.fn();
        fixture.componentInstance.backClicked.subscribe(backClicked);
        fixture.detectChanges();
        const backNavigation = TestBed.inject(WorkspaceBackNavigationService);

        // Available while the profile loads, too.
        expect(
            (fixture.nativeElement as HTMLElement).querySelector('button')
        ).toBeNull();
        expect(backNavigation.target()?.escapeShortcut()).toBe(false);
        backNavigation.goBack();
        expect(backClicked).toHaveBeenCalledTimes(1);

        fixture.destroy();
        expect(backNavigation.target()).toBeNull();
    });
});
