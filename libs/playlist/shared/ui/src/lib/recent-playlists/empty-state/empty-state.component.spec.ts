import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent', () => {
    let fixture: ComponentFixture<EmptyStateComponent>;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [EmptyStateComponent, TranslateModule.forRoot()],
            providers: [provideNoopAnimations()],
        }).compileComponents();
        fixture = TestBed.createComponent(EmptyStateComponent);
        fixture.componentRef.setInput('type', 'welcome-sources');
        fixture.detectChanges();
    }));

    it('offers bulk import as one of the initial setup source cards', () => {
        const cards = fixture.nativeElement.querySelectorAll('.source-card');
        expect(cards).toHaveLength(4);

        const bulk = fixture.nativeElement.querySelectorAll(
            '.source-card:last-child'
        )[0];
        // The standalone test env has no catalog loaded, so translate() keeps
        // the keys; asserting the keys still pins the card vocabulary.
        expect(bulk.textContent).toContain(
            'HOME.ADD_PLAYLIST.METHOD_BULK_LABEL'
        );
    });

    it('opens the bulk form from the card action', () => {
        const picked: (string | undefined)[] = [];
        fixture.componentInstance.addPlaylistClicked.subscribe((type) =>
            picked.push(type)
        );

        const buttons: HTMLButtonElement[] = Array.from(
            fixture.nativeElement.querySelectorAll('.source-card__cta')
        );
        buttons[buttons.length - 1].click();

        expect(picked).toEqual(['bulk']);
    });
});
