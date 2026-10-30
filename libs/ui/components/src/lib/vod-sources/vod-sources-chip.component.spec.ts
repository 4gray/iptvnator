import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { VodSourceDescriptor } from '@iptvnator/shared/interfaces';
import { VodSourcesChipComponent } from './vod-sources-chip.component';

function createSource(
    overrides: Partial<VodSourceDescriptor>
): VodSourceDescriptor {
    return {
        id: 'playlist-1:xtream:42',
        playlistId: 'playlist-1',
        playlistName: 'Portal',
        portalType: 'xtream',
        contentId: 42,
        rawTitle: 'Example Movie',
        matchConfidence: 'exact',
        year: 2024,
        isActive: false,
        isPinned: false,
        isTried: false,
        probe: { status: 'idle' },
        ...overrides,
    };
}

describe('VodSourcesChipComponent', () => {
    let fixture: ComponentFixture<VodSourcesChipComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [VodSourcesChipComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fixture = TestBed.createComponent(VodSourcesChipComponent);
        fixture.componentRef.setInput('sources', [
            createSource({
                id: 'a:xtream:1',
                playlistId: 'a',
                playlistName: 'Portal A',
                rawTitle: 'EN| Example Movie (2024)',
            }),
            createSource({
                id: 'b:xtream:2',
                playlistId: 'b',
                playlistName: 'Portal B',
                rawTitle: 'DE| Example Movie (2024)',
            }),
        ]);
        fixture.detectChanges();
    });

    it('closes only the language menu on Escape: the sources popover stays open', async () => {
        (
            fixture.nativeElement.querySelector(
                '.sources-chip'
            ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        const languageChip = document.querySelector<HTMLButtonElement>(
            '.sources-menu__lang'
        );
        expect(languageChip).not.toBeNull();
        languageChip?.focus();
        languageChip?.click();
        fixture.detectChanges();
        await fixture.whenStable();

        expect(languageChip?.getAttribute('aria-expanded')).toBe('true');
        const row = document.querySelector<HTMLElement>(
            '.sources-language-menu [role="menuitemradio"]'
        );
        expect(row).not.toBeNull();

        // The overlay dispatcher hands a keydown to the topmost overlay
        // only: the language menu, not the popover beneath it.
        row?.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                keyCode: 27,
                bubbles: true,
            })
        );
        fixture.detectChanges();
        await fixture.whenStable();

        expect(languageChip?.getAttribute('aria-expanded')).toBe('false');
        expect(fixture.componentInstance.isOpen()).toBe(true);
        expect(document.querySelector('.sources-menu__lang')).toBe(
            languageChip
        );

        // Material detaches the menu after its exit animation; with the
        // language menu gone, the next Escape reaches the popover.
        for (
            let wait = 0;
            wait < 20 && document.querySelector('.sources-language-menu');
            wait++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(document.querySelector('.sources-language-menu')).toBeNull();
        languageChip?.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                keyCode: 27,
                bubbles: true,
            })
        );
        fixture.detectChanges();
        expect(fixture.componentInstance.isOpen()).toBe(false);
    });
});
