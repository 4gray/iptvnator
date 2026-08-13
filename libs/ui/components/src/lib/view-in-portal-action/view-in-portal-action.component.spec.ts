import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ViewInPortalActionComponent } from './view-in-portal-action.component';
import {
    VIEW_IN_PORTAL_HANDOFF,
    ViewInPortalHandoff,
} from './view-in-portal-handoff.token';

@Component({
    imports: [ViewInPortalActionComponent],
    template: `<app-view-in-portal-action />`,
})
class HostComponent {}

const BUTTON_SELECTOR = '[data-testid="collection-view-in-portal"]';

describe('ViewInPortalActionComponent', () => {
    function createHandoff(
        overrides: Partial<{
            available: boolean;
            playlistName: string | null;
        }> = {}
    ): ViewInPortalHandoff & { openInPortal: jest.Mock } {
        return {
            viewInPortalAvailable: signal(overrides.available ?? true),
            viewInPortalPlaylistName: signal(
                overrides.playlistName ?? null
            ),
            openInPortal: jest.fn(),
        };
    }

    async function createFixture(
        handoff: ViewInPortalHandoff | null
    ): Promise<ComponentFixture<HostComponent>> {
        await TestBed.configureTestingModule({
            imports: [HostComponent, TranslateModule.forRoot()],
            providers: handoff
                ? [{ provide: VIEW_IN_PORTAL_HANDOFF, useValue: handoff }]
                : [],
        }).compileComponents();

        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        return fixture;
    }

    it('renders nothing and hides the host without a handoff token', async () => {
        const fixture = await createFixture(null);

        expect(fixture.debugElement.query(By.css(BUTTON_SELECTOR))).toBeNull();
        const host = fixture.debugElement.query(
            By.directive(ViewInPortalActionComponent)
        );
        expect(
            host.nativeElement.classList.contains(
                'view-in-portal-action--hidden'
            )
        ).toBe(true);
    });

    it('stays hidden while the handoff reports the target unavailable', async () => {
        const fixture = await createFixture(
            createHandoff({ available: false })
        );

        expect(fixture.debugElement.query(By.css(BUTTON_SELECTOR))).toBeNull();
        const host = fixture.debugElement.query(
            By.directive(ViewInPortalActionComponent)
        );
        expect(
            host.nativeElement.classList.contains(
                'view-in-portal-action--hidden'
            )
        ).toBe(true);
    });

    it('renders the button and forwards clicks to the handoff', async () => {
        const handoff = createHandoff({ available: true });
        const fixture = await createFixture(handoff);

        const button = fixture.debugElement.query(By.css(BUTTON_SELECTOR));
        expect(button).not.toBeNull();
        const host = fixture.debugElement.query(
            By.directive(ViewInPortalActionComponent)
        );
        expect(
            host.nativeElement.classList.contains(
                'view-in-portal-action--hidden'
            )
        ).toBe(false);

        button.nativeElement.click();
        expect(handoff.openInPortal).toHaveBeenCalledTimes(1);
    });

    it('uses the playlist name for the tooltip when provided', async () => {
        const fixture = await createFixture(
            createHandoff({ available: true, playlistName: 'My Portal' })
        );
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: { VIEW_IN_PORTAL_TOOLTIP: 'Open in {{name}}' },
        });
        translate.use('en');
        fixture.detectChanges();

        const button = fixture.debugElement.query(By.css(BUTTON_SELECTOR));
        const tooltip = button.injector.get(MatTooltip);
        expect(tooltip.message).toBe('Open in My Portal');
    });
});
