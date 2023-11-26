import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { SharedModule } from '../shared/shared.module';
import { DragDropFileUploadDirective } from './file-upload/drag-drop-file-upload.directive';
import { HomeComponent } from './home.component';
import { HomeRoutingModule } from './home.routing';
import { StalkerPortalImportComponent } from './stalker-portal-import/stalker-portal-import.component';
import { XtreamCodeImportComponent } from './xtream-code-import/xtream-code-import.component';

@NgModule({
    imports: [
        CommonModule,
        HomeRoutingModule,
        SharedModule,
        XtreamCodeImportComponent,
        StalkerPortalImportComponent,
    ],
    declarations: [DragDropFileUploadDirective, HomeComponent],
})
export class HomeModule {}
