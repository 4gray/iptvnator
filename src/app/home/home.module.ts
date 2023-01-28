import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { SharedModule } from '../shared/shared.module';
import { DragDropFileUploadDirective } from './file-upload/drag-drop-file-upload.directive';
import { FileUploadComponent } from './file-upload/file-upload.component';
import { HomeComponent } from './home.component';
import { HomeRoutingModule } from './home.routing';
import { TextImportComponent } from './text-import/text-import.component';
import { UrlUploadComponent } from './url-upload/url-upload.component';
@NgModule({
    imports: [CommonModule, HomeRoutingModule, SharedModule],
    declarations: [
        DragDropFileUploadDirective,
        HomeComponent,
        FileUploadComponent,
        TextImportComponent,
        UrlUploadComponent,
    ],
})
export class HomeModule {}
