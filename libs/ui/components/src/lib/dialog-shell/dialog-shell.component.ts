import {
    ChangeDetectionStrategy,
    Component,
    computed,
    contentChild,
    input,
    ViewEncapsulation,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    DialogFooterDirective,
    DialogFooterStartDirective,
} from './dialog-shell.directives';

export type DialogIconTone = 'default' | 'warn';
/**
 * How the body lays out its content. `block` is a normal flow; `column`
 * makes the body a flex column, so a child can take the height left under
 * the dialog's cap and own the scrolling (a picker whose search and bulk
 * actions stay put while its list scrolls).
 */
export type DialogBodyLayout = 'block' | 'column';

/**
 * The UI kit's dialog shell: a header with an optional icon tile, the
 * heading (`mat-dialog-title`, so the container is named by it), an optional
 * subtitle and a close button; the body; and a footer that renders only when
 * actions are projected into it.
 *
 * Slots: the body is the default content; an element with
 * `appDialogFooter` wraps the decision buttons, `appDialogFooterStart` the
 * content at the footer's start, `appDialogHeaderEnd` the content before the
 * close button. Conditional buttons go inside the wrapper: a control-flow
 * block at the top level of the content is projected into the body.
 *
 * The close button is the last element in the DOM and positioned into the
 * header, so Material's `first-tabbable` autofocus lands in the body and Tab
 * reaches the close button after the footer. It is named "Close dialog", so a
 * footer "Close" stays the only button of that name.
 */
@Component({
    selector: 'app-dialog-shell',
    imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
    templateUrl: './dialog-shell.component.html',
    styleUrl: './dialog-shell.component.scss',
    // The footer buttons and the header-end content are projected from the
    // dialog's own template; the rules below reach them through the
    // `app-dialog__*` classes.
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    // A footer-less dialog keeps its body as the scroll owner in a short
    // window (see the stylesheet): its header close is its only in-dialog
    // dismissal and must stay in place.
    host: { '[class.app-dialog--footerless]': '!hasFooter()' },
})
export class DialogShellComponent {
    /** The translated heading; it names the dialog for assistive tech. */
    readonly heading = input.required<string>();
    readonly subtitle = input<string>();
    /** A Material icon name for the 40px tile before the heading. */
    readonly icon = input<string>();
    readonly iconTone = input<DialogIconTone>('default');
    /**
     * The header close button. It closes with no result, as Escape and the
     * backdrop do, so a caller that reads the result sees a cancel. A dialog
     * that must not be dismissed while it works (a save or a deletion in
     * flight) hides it meanwhile, since `mat-dialog-close` ignores
     * `disableClose`.
     */
    readonly showClose = input(true);
    readonly bodyLayout = input<DialogBodyLayout>('block');

    private readonly footer = contentChild(DialogFooterDirective);
    private readonly footerStart = contentChild(DialogFooterStartDirective);

    protected readonly hasFooter = computed(
        () => this.footer() !== undefined || this.footerStart() !== undefined
    );
}
