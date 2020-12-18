import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { FlexLayoutModule } from '@angular/flex-layout';
import { HeaderComponent } from './components/';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MaterialModule } from 'app/material.module';
import { FilterPipeModule } from 'ngx-filter-pipe';

@NgModule({
    declarations: [HeaderComponent],
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
        FilterPipeModule,
        FlexLayoutModule,
        FormsModule,
        HeaderComponent,
        MaterialModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
})
export class SharedModule {}
