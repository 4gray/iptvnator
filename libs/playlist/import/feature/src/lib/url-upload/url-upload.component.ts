import {
    Component,
    inject,
    computed,
    output,
    ElementRef,
    viewChild,
    ChangeDetectionStrategy,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import {
    FormBuilder,
    FormControl,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { RevealDetailsDirective } from '@iptvnator/ui/components/reveal-details';
import {
    suggestXtreamFromUrl,
    UrlXtreamSuggestion,
} from './url-xtream-suggestion';

@Component({
    selector: 'app-url-upload',
    providers: [provideFormFieldDefaults()],
    templateUrl: './url-upload.component.html',
    styleUrl: './url-upload.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        ReactiveFormsModule,
        TranslatePipe,
        RevealDetailsDirective,
    ],
})
export class UrlUploadComponent {
    private readonly fb = inject(FormBuilder);
    private readonly runtime = inject(RuntimeCapabilitiesService);

    readonly form: FormGroup<{
        playlistName: FormControl<string>;
        playlistUrl: FormControl<string>;
        userAgent: FormControl<string>;
    }> = this.fb.nonNullable.group({
        playlistUrl: [
            '',
            [
                Validators.required,
                (control) => {
                    try {
                        const url = new URL(control.value.trim());
                        return /^https?:\/\//i.test(control.value.trim()) &&
                            /^https?:$/.test(url.protocol) &&
                            url.hostname
                            ? null
                            : { url: true };
                    } catch {
                        return { url: true };
                    }
                },
            ],
        ],
        playlistName: [''],
        userAgent: [''],
    });
    readonly isDesktop = this.runtime.isElectron;
    readonly userAgent = toSignal(this.form.controls.userAgent.valueChanges, {
        initialValue: '',
    });
    private readonly urlInput =
        viewChild<ElementRef<HTMLInputElement>>('urlInput');
    readonly xtreamSelected = output<UrlXtreamSuggestion>();
    private readonly playlistUrl = toSignal(
        this.form.controls.playlistUrl.valueChanges,
        {
            initialValue: '',
        }
    );
    readonly xtreamSuggestion = computed(() =>
        suggestXtreamFromUrl(this.playlistUrl())
    );

    focusUrl(): void {
        this.urlInput()?.nativeElement.focus();
    }

    useXtream(): void {
        const candidate = this.xtreamSuggestion();
        if (!candidate || this.form.disabled) return;
        const draft = this.form.getRawValue();
        this.xtreamSelected.emit({
            ...candidate,
            suggestedTitle:
                draft.playlistName.trim() || candidate.suggestedTitle,
            userAgent: draft.userAgent.trim() || undefined,
        });
    }

    clearForm(): void {
        this.form.reset({
            playlistName: '',
            playlistUrl: '',
            userAgent: '',
        });
    }
}
