declare module '@angular/material/snack-bar' {
    export class MatSnackBar {
        open(
            message: string,
            action?: string,
            config?: { duration?: number }
        ): void;
    }
}
