import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { provideRouter } from '@angular/router';
import { WorkspaceShellRailLinksComponent } from './workspace-shell-rail-links.component';

describe('WorkspaceShellRailLinksComponent', () => {
    let fixture: ComponentFixture<WorkspaceShellRailLinksComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WorkspaceShellRailLinksComponent],
            providers: [provideRouter([])],
        }).compileComponents();

        fixture = TestBed.createComponent(WorkspaceShellRailLinksComponent);
        fixture.componentRef.setInput('links', [
            {
                icon: 'dashboard',
                tooltip: 'Dashboard',
                path: ['/workspace/dashboard'],
                exact: true,
            },
            {
                icon: 'movie',
                tooltip: 'Movies',
                path: ['/workspace/movies'],
            },
        ]);
    });

    it('keeps labels hidden and tooltips enabled in the compact rail', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelectorAll('.portal-rail-link-label')
        ).toHaveLength(0);
        expect(
            fixture.debugElement
                .queryAll(By.directive(MatTooltip))[0]
                .injector.get(MatTooltip).disabled
        ).toBe(false);
    });

    it('renders every label and disables redundant tooltips when expanded', () => {
        fixture.componentRef.setInput('expanded', true);
        fixture.detectChanges();

        const labels = Array.from(
            fixture.nativeElement.querySelectorAll('.portal-rail-link-label')
        ).map((element: Element) => element.textContent?.trim());

        expect(labels).toEqual(['Dashboard', 'Movies']);
        expect(
            fixture.nativeElement
                .querySelector('.rail-links')
                ?.classList.contains('is-expanded')
        ).toBe(true);
        expect(
            fixture.debugElement
                .queryAll(By.directive(MatTooltip))[0]
                .injector.get(MatTooltip).disabled
        ).toBe(true);
    });
});
