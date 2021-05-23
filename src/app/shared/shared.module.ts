import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { FlexLayoutModule } from '@angular/flex-layout';
import { HeaderComponent } from './components/';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MaterialModule } from '../material.module';
import { FilterPipeModule } from 'ngx-filter-pipe';
import { MomentDatePipe } from './pipes/moment-date.pipe';
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component';

@NgModule({
    declarations: [ConfirmDialogComponent, HeaderComponent, MomentDatePipe],
    imports: [
        CommonModule,
        FilterPipeModule,
        FlexLayoutModule,
        FormsModule,
        MaterialModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    exports: [
        ConfirmDialogComponent,
        FilterPipeModule,
        FlexLayoutModule,
        FormsModule,
        HeaderComponent,
        MaterialModule,
        MomentDatePipe,
        ReactiveFormsModule,
        TranslateModule,
    ],
})
export class SharedModule {}
