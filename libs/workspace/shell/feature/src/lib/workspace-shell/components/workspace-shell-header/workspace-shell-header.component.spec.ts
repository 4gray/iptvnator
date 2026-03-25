import {
    Component,
    input,
    output,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { AddPlaylistMenuComponent } from '@iptvnator/playlist/shared/ui';
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
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();
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
                        AddPlaylistMenuComponent,
                        MatIcon,
                        MatIconButton,
                        MatMenuModule,
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

    it('emits header bulk action requests when the action button is clicked', () => {
        const requested = jest.fn();
        component.headerBulkActionRequested.subscribe(requested);
        fixture.componentRef.setInput('headerBulkAction', {
            icon: 'delete_sweep',
            tooltip: 'clear',
            ariaLabel: 'clear recent',
            disabled: false,
        });
        fixture.detectChanges();

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            'button[aria-label="clear recent"]'
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
