import { Component, input, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DialogShellComponent } from './dialog-shell.component';
import {
    DialogFooterDirective,
    DialogFooterStartDirective,
    DialogHeaderEndDirective,
} from './dialog-shell.directives';

@Component({
    imports: [
        DialogShellComponent,
        DialogFooterDirective,
        DialogFooterStartDirective,
        DialogHeaderEndDirective,
    ],
    // The slot wrappers sit at the top level of the content: a control-flow
    // block there would be projected into the body, so the conditional
    // action lives inside the footer wrapper.
    template: `
        <app-dialog-shell
            heading="Remove playlist"
            subtitle="Pick how"
            icon="keyboard"
            [showClose]="showClose()"
        >
            <span appDialogHeaderEnd>macOS</span>
            <p>Body text</p>
            <div appDialogFooterStart><button>Clear</button></div>
            <div appDialogFooter>
                <button>Cancel</button>
                @if (withRemove()) {
                    <button>Remove</button>
                }
            </div>
        </app-dialog-shell>
    `,
})
class FullHostComponent {
    readonly showClose = input(true);
    readonly withRemove = input(true);
}

@Component({
    imports: [DialogShellComponent],
    template: `
        <app-dialog-shell heading="Keyboard shortcuts">
            <p>Body only</p>
        </app-dialog-shell>
    `,
})
class BareHostComponent {}

@Component({
    imports: [DialogShellComponent],
    template: `
        <app-dialog-shell heading="Manage groups" bodyLayout="column">
            <div>A list that scrolls</div>
        </app-dialog-shell>
    `,
})
class ColumnHostComponent {}

describe('DialogShellComponent', () => {
    const close = jest.fn();

    async function render<T>(
        host: Type<T>,
        inputs: Partial<Record<string, unknown>> = {}
    ) {
        await TestBed.configureTestingModule({
            imports: [host, TranslateModule.forRoot()],
            providers: [{ provide: MatDialogRef, useValue: { close } }],
        }).compileComponents();
        const fixture = TestBed.createComponent(host);
        for (const [name, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(name, value);
        }
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    beforeEach(() => close.mockClear());

    it('names the dialog by the heading and projects the header, body and footer slots in order, including a conditional action', async () => {
        const root = await render(FullHostComponent);

        const title = root.querySelector('h2.app-dialog__title');
        expect(title?.textContent?.trim()).toBe('Remove playlist');
        expect(title?.id).toMatch(/^mat-mdc-dialog-title-/);
        expect(
            root.querySelector('.app-dialog__subtitle')?.textContent?.trim()
        ).toBe('Pick how');
        expect(
            root.querySelector('.app-dialog__icon mat-icon')?.textContent
        ).toBe('keyboard');
        expect(
            root.querySelector('.app-dialog__header-end')?.textContent?.trim()
        ).toBe('macOS');
        expect(root.querySelector('.app-dialog__body')?.textContent).toContain(
            'Body text'
        );
        const footerTexts = Array.from(
            root.querySelectorAll('.app-dialog__footer button')
        ).map((button) => button.textContent?.trim());
        expect(footerTexts).toEqual(['Clear', 'Cancel', 'Remove']);
        expect(
            root
                .querySelector('app-dialog-shell')
                ?.classList.contains('app-dialog--footerless')
        ).toBe(false);
    });

    it('drops a conditional action from the footer without losing the others', async () => {
        const root = await render(FullHostComponent, { withRemove: false });

        const footerTexts = Array.from(
            root.querySelectorAll('.app-dialog__footer button')
        ).map((button) => button.textContent?.trim());
        expect(footerTexts).toEqual(['Clear', 'Cancel']);
    });

    it('renders no footer, icon tile or subtitle when nothing is projected or set, and marks itself footer-less', async () => {
        const root = await render(BareHostComponent);

        expect(root.querySelector('.app-dialog__footer')).toBeNull();
        // The short-window stylesheet keys on the class: such a dialog keeps
        // its body scrolling so the header close stays in place.
        expect(
            root
                .querySelector('app-dialog-shell')
                ?.classList.contains('app-dialog--footerless')
        ).toBe(true);
        expect(root.querySelector('.app-dialog__icon')).toBeNull();
        expect(root.querySelector('.app-dialog__subtitle')).toBeNull();
        expect(root.querySelector('.app-dialog__body')?.textContent).toContain(
            'Body only'
        );
    });

    it('closes through the header button, which comes last in the DOM so autofocus lands in the body', async () => {
        const root = await render(FullHostComponent);

        const buttons = Array.from(root.querySelectorAll('button'));
        const closeButton = buttons.at(-1) as HTMLButtonElement;
        expect(closeButton.classList).toContain('app-dialog__close');
        expect(closeButton.getAttribute('aria-label')).toBe('CLOSE_DIALOG');
        closeButton.click();
        expect(close).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledWith(undefined);
    });

    it('lays the body out as a flex column on request, so a child can own the scrolling', async () => {
        const root = await render(BareHostComponent);
        const body = root.querySelector('.app-dialog__body');
        expect(body?.classList.contains('app-dialog__body--column')).toBe(
            false
        );

        TestBed.resetTestingModule();
        const column = await render(ColumnHostComponent);
        expect(
            column
                .querySelector('.app-dialog__body')
                ?.classList.contains('app-dialog__body--column')
        ).toBe(true);
    });

    it('hides the close button on request', async () => {
        const root = await render(FullHostComponent, { showClose: false });

        expect(root.querySelector('.app-dialog__close')).toBeNull();
    });
});
