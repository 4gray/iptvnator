import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { HeaderComponent } from '../shared/components/header/header.component';
import { SharedModule } from '../shared/shared.module';
import { DragDropFileUploadDirective } from './file-upload/drag-drop-file-upload.directive';
import { HomeComponent } from './home.component';
import { HomeRoutingModule } from './home.routing';

@NgModule({
    imports: [CommonModule, HeaderComponent, HomeRoutingModule, SharedModule],
    declarations: [DragDropFileUploadDirective, HomeComponent],
})
export class HomeModule {}
