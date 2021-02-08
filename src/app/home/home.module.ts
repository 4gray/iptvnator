import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '../shared/shared.module';
import { HomeComponent } from './home.component';
import { FileUploadComponent } from './file-upload/file-upload.component';
import { UrlUploadComponent } from './url-upload/url-upload.component';
import { RecentPlaylistsComponent } from './recent-playlists/recent-playlists.component';
import { HomeRoutingModule } from './home.routing';
import { NgxUploaderModule } from 'ngx-uploader';

@NgModule({
    imports: [CommonModule, HomeRoutingModule, NgxUploaderModule, SharedModule],
    declarations: [
        HomeComponent,
        FileUploadComponent,
        UrlUploadComponent,
        RecentPlaylistsComponent,
    ],
})
export class HomeModule {}
