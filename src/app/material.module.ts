import { NgModule } from '@angular/core';
import {
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
    MatInputModule,
} from '@angular/material';

@NgModule({
    exports: [
        MatButtonModule,
        MatCardModule,
        MatIconModule,
        MatInputModule,
        MatListModule,
        MatSidenavModule,
        MatToolbarModule,
    ],
})
export class MaterialModule {}
