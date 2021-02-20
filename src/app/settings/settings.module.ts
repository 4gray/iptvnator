import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SettingsComponent } from './settings.component';
import { SettingsRoutingModule } from './settings.routing';
import { SharedModule } from '../shared/shared.module';

@NgModule({
    imports: [CommonModule, SettingsRoutingModule, SharedModule],
    declarations: [SettingsComponent],
})
export class SettingsModule {}
