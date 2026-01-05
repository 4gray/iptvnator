import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-content-hero',
    standalone: true,
    imports: [CommonModule, MatIconModule, MatButtonModule],
    templateUrl: './content-hero.component.html',
    styleUrls: ['./content-hero.component.scss'],
})
export class ContentHeroComponent {
    @Input() title: string | undefined;
    @Input() description: string | undefined;
    @Input() posterUrl: string | undefined;
    @Input() backdropUrl: string | undefined;

    @Output() backClicked = new EventEmitter<void>();

    onBack(): void {
        this.backClicked.emit();
    }
}
