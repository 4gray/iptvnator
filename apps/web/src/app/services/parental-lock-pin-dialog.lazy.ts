/**
 * Lazy boundary for the parental-lock prompt: the prompt service imports
 * this file dynamically, so the PIN dialog and the @angular/forms and
 * Material form-field modules it brings stay off the initial path. The
 * boundary is a local file backed by a file-level alias, like the other
 * root-shell lazy dialogs (see docs/architecture/nx-workspace-boundaries.md).
 */
export { ParentalLockPinDialogComponent } from '@iptvnator/ui/components/parental-lock-pin-dialog';
