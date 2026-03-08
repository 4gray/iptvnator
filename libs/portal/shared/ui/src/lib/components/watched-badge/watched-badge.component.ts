import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-watched-badge',
    standalone: true,
    imports: [MatIcon],
    template: `
        @if (isWatched()) {
        <div class="watched-badge">
            <mat-icon>{{ icon() }}</mat-icon>
        </div>
        }
    `,
    styles: [
        `
            .watched-badge {
                position: absolute;
                top: 8px;
                left: 8px;
                width: 24px;
                height: 24px;
                background: rgba(70, 211, 105, 0.9);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(4px);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

                mat-icon {
                    font-size: 16px;
                    width: 16px;
                    height: 16px;
                    color: white;
                }
            }
        `,
    ],
})
export class WatchedBadgeComponent {
    readonly isWatched = input.required<boolean>();
    readonly icon = input<string>('check_circle');
}
