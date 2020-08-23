import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { TranslateModule } from '@ngx-translate/core';
import { FlexLayoutModule } from '@angular/flex-layout';
import { PageNotFoundComponent } from './components/';
import { WebviewDirective } from './directives/';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from 'app/material.module';

@NgModule({
    declarations: [PageNotFoundComponent, WebviewDirective],
    imports: [
        CommonModule,
        TranslateModule,
        FormsModule,
        MaterialModule,
        FlexLayoutModule,
    ],
    exports: [
        TranslateModule,
        WebviewDirective,
        FormsModule,
        MaterialModule,
        FlexLayoutModule,
    ],
})
export class SharedModule {}
