import { Directive } from '@angular/core';

/**
 * Wraps the footer actions of an `app-dialog-shell`. The wrapper renders as
 * `display: contents`, so the buttons sit in the footer's flex row in DOM
 * order, the dismiss first and the primary last, and `@if`/`@switch`
 * blocks inside it stay in the footer (a block at the top level of the
 * dialog's content would be projected into the body instead).
 */
@Directive({ selector: '[appDialogFooter]' })
export class DialogFooterDirective {}

/**
 * Wraps content that sits at the start of the footer, away from the
 * decision buttons, such as a Clear action or a notice.
 */
@Directive({ selector: '[appDialogFooterStart]' })
export class DialogFooterStartDirective {}

/** Wraps content shown at the end of the header, before the close button. */
@Directive({ selector: '[appDialogHeaderEnd]' })
export class DialogHeaderEndDirective {}
