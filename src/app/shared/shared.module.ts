import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { TranslateModule } from '@ngx-translate/core';
import { FlexLayoutModule } from '@angular/flex-layout';
import { PageNotFoundComponent, HeaderComponent } from './components/';
import { WebviewDirective } from './directives/';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MaterialModule } from 'app/material.module';

@NgModule({
    declarations: [PageNotFoundComponent, HeaderComponent, WebviewDirective],
    imports: [
        CommonModule,
        TranslateModule,
        FormsModule,
        MaterialModule,
        FlexLayoutModule,
        ReactiveFormsModule,
    ],
    exports: [
        TranslateModule,
        WebviewDirective,
        FormsModule,
        MaterialModule,
        FlexLayoutModule,
        HeaderComponent,
        ReactiveFormsModule,
    ],
})
export class SharedModule {}
