import {
    Component,
    Directive,
    input,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkspaceShellContextSidebarComponent } from './workspace-shell-context-sidebar.component';

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
class MockResizableDirective {
    readonly minWidth = input<number | null>(null);
    readonly maxWidth = input<number | null>(null);
    readonly defaultWidth = input<number | null>(null);
    readonly storageKey = input<string | null>(null);
}

@Component({
    selector: 'app-workspace-context-panel',
    template: '',
    standalone: true,
})
class MockWorkspaceContextPanelComponent {
    readonly context = input.required<unknown>();
    readonly section = input.required<string>();
}

@Component({
    selector: 'app-workspace-collection-context-panel',
    template: '',
    standalone: true,
})
class MockWorkspaceCollectionContextPanelComponent {}

@Component({
    selector: 'app-workspace-settings-context-panel',
    template: '',
    standalone: true,
})
class MockWorkspaceSettingsContextPanelComponent {}

@Component({
    selector: 'app-workspace-sources-filters-panel',
    template: '',
    standalone: true,
})
class MockWorkspaceSourcesFiltersPanelComponent {}

describe('WorkspaceShellContextSidebarComponent', () => {
    let fixture: ComponentFixture<WorkspaceShellContextSidebarComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WorkspaceShellContextSidebarComponent],
        })
            .overrideComponent(WorkspaceShellContextSidebarComponent, {
                set: {
                    imports: [
                        MockResizableDirective,
                        MockWorkspaceContextPanelComponent,
                        MockWorkspaceCollectionContextPanelComponent,
                        MockWorkspaceSettingsContextPanelComponent,
                        MockWorkspaceSourcesFiltersPanelComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WorkspaceShellContextSidebarComponent);
    });

    it('renders the settings panel for the settings variant', () => {
        fixture.componentRef.setInput('variant', 'settings');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                'app-workspace-settings-context-panel'
            )
        ).not.toBeNull();
    });

    it('renders the route context panel for category routes', () => {
        fixture.componentRef.setInput('variant', 'category');
        fixture.componentRef.setInput('context', {
            provider: 'xtreams',
            playlistId: 'pl-1',
        });
        fixture.componentRef.setInput('section', 'vod');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-workspace-context-panel')
        ).not.toBeNull();
    });

    it('renders the shared collection panel for collection routes', () => {
        fixture.componentRef.setInput('variant', 'collection');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                'app-workspace-collection-context-panel'
            )
        ).not.toBeNull();
    });
});
