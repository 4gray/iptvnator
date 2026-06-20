import {
    Component,
    input,
    output,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkspaceShellHeaderComponent } from './workspace-shell-header.component';

@Component({
    selector: 'app-playlist-switcher',
    template: '',
    standalone: true,
})
class MockPlaylistSwitcherComponent {
    readonly currentTitle = input.required<string>();
    readonly subtitle = input('');
    readonly showPlaylistInfo = input(false);
    readonly showAccountInfo = input(false);
    readonly showAddPlaylist = input(false);
    readonly canRefreshActivePlaylist = input(false);
    readonly isRefreshingActivePlaylist = input(false);
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly refreshPlaylistRequested = output<void>();
}

describe('WorkspaceShellHeaderComponent', () => {
    let fixture: ComponentFixture<WorkspaceShellHeaderComponent>;
    let component: WorkspaceShellHeaderComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WorkspaceShellHeaderComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceShellHeaderComponent, {
                set: {
                    imports: [
                        MatIcon,
                        MatIconButton,
                        MatTooltip,
                        MockPlaylistSwitcherComponent,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WorkspaceShellHeaderComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('playlistTitle', 'Playlist A');
        fixture.componentRef.setInput('playlistSubtitle', 'Subtitle');
        fixture.componentRef.setInput('searchQuery', 'neo');
        fixture.componentRef.setInput('canUseSearch', true);
        fixture.componentRef.setInput(
            'searchPlaceholder',
            'WORKSPACE.SHELL.SEARCH_PLAYLIST_PLACEHOLDER'
        );
        fixture.detectChanges();
    });

    it('emits search input changes as user types', () => {
        const emitted: string[] = [];
        component.searchChanged.subscribe((value) => emitted.push(value));
        const input: HTMLInputElement =
            fixture.nativeElement.querySelector('input[type="search"]');

        input.value = 'matrix';
        input.dispatchEvent(new Event('input'));

        expect(emitted).toEqual(['matrix']);
    });

    it('focuses and selects the search input on request', () => {
        const input: HTMLInputElement =
            fixture.nativeElement.querySelector('input[type="search"]');
        input.value = 'matrix';
        input.blur();

        component.focusSearchInput({ select: true });

        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe('matrix'.length);
    });

    it('emits add playlist requests when the toolbar add button is clicked', () => {
        const requested = jest.fn();
        component.addPlaylistRequested.subscribe(requested);

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            'button[aria-label="WORKSPACE.SHELL.ADD_PLAYLIST"]'
        );
        button.click();

        expect(requested).toHaveBeenCalledTimes(1);
    });

    it('emits keyboard shortcuts requests from the help button', () => {
        const requested = jest.fn();
        component.shortcutsRequested.subscribe(requested);

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            'button[aria-label="WORKSPACE.SHORTCUTS.OPEN_ARIA"]'
        );
        button.click();

        expect(requested).toHaveBeenCalledTimes(1);
    });

    it('does not render the removed global favorites shortcut', () => {
        const button: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                'button[aria-label="WORKSPACE.SHELL.OPEN_GLOBAL_FAVORITES"]'
            );

        expect(button).toBeNull();
    });

    it('emits contextual header shortcut requests when configured', () => {
        const requested = jest.fn();
        component.headerShortcutRequested.subscribe(requested);
        fixture.componentRef.setInput('headerShortcut', {
            icon: 'tune',
            tooltipKey: 'shortcut.tooltip',
            ariaLabelKey: 'shortcut.aria',
            run: () => undefined,
        });
        fixture.detectChanges();

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            'button[aria-label="shortcut.aria"]'
        );
        button.click();

        expect(requested).toHaveBeenCalledTimes(1);
    });

    it('renders scope and status chips when search metadata is provided', () => {
        fixture.componentRef.setInput('searchScopeLabel', 'Movies / All Items');
        fixture.componentRef.setInput(
            'searchStatusLabel',
            'Loaded channels only'
        );
        fixture.detectChanges();

        const chips = Array.from(
            fixture.nativeElement.querySelectorAll('.search-chip')
        ).map((element: Element) => element.textContent?.trim());

        expect(chips).toEqual(['Movies / All Items', 'Loaded channels only']);
    });
});
