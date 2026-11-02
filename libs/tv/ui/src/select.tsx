import { useId, useRef, useState } from 'preact/hooks';
import { TvDialog } from './dialog';

export interface TvOption {
    value: string;
    label: string;
}
export function TvSelect({
    label,
    value,
    options,
    onChange,
    disabled,
    focusKey,
    placeholder = 'Choose an option',
}: {
    label: string;
    value: string;
    options: TvOption[];
    onChange: (value: string, control: HTMLButtonElement) => void;
    disabled?: boolean;
    focusKey?: string;
    placeholder?: string;
}) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const filtered = options.filter((option) =>
        option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    );
    return (
        <>
            <button
                ref={trigger}
                type="button"
                class="tv-select"
                role="combobox"
                data-value={value}
                aria-label={label}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                data-focus={focusKey ?? id}
                disabled={disabled || !options.length}
                onClick={() => {
                    setQuery('');
                    setOpen(true);
                }}
            >
                <span>
                    {options.find((option) => option.value === value)?.label ??
                        placeholder}
                </span>
                <svg
                    aria-hidden="true"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                >
                    <path
                        d="m6 9 6 6 6-6"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    />
                </svg>
            </button>
            {open ? (
                <TvDialog title={label} close={() => setOpen(false)}>
                    {options.length > 12 ? (
                        <label class="tv-picker-search">
                            Filter options
                            <input
                                type="search"
                                aria-label={`Filter ${label}`}
                                value={query}
                                onInput={(event) =>
                                    setQuery(event.currentTarget.value)
                                }
                            />
                        </label>
                    ) : null}
                    <div
                        id={id}
                        class="tv-picker-options"
                        role="listbox"
                        aria-label={label}
                        onKeyDown={(event) => {
                            const key =
                                (
                                    {
                                        38: 'ArrowUp',
                                        40: 'ArrowDown',
                                    } as Record<number, string>
                                )[event.keyCode] ?? event.key;
                            if (
                                ![
                                    'ArrowUp',
                                    'ArrowDown',
                                    'Home',
                                    'End',
                                    'PageUp',
                                    'PageDown',
                                ].includes(key)
                            )
                                return;
                            const choices = Array.from(
                                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                                    'button'
                                )
                            );
                            const index = choices.indexOf(
                                document.activeElement as HTMLButtonElement
                            );
                            if (key === 'ArrowUp' && index === 0) return;
                            const next =
                                key === 'Home'
                                    ? 0
                                    : key === 'End'
                                      ? choices.length - 1
                                      : index +
                                        (key === 'PageUp'
                                            ? -6
                                            : key === 'PageDown'
                                              ? 6
                                              : key === 'ArrowUp'
                                                ? -1
                                                : 1);
                            const target =
                                choices[
                                    Math.max(
                                        0,
                                        Math.min(choices.length - 1, next)
                                    )
                                ];
                            target?.focus();
                            target?.scrollIntoView({ block: 'nearest' });
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                    >
                        {filtered.map((option, index) => (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                data-value={option.value}
                                aria-selected={value === option.value}
                                tabIndex={-1}
                                data-dialog-initial={
                                    option.value === value ||
                                    (!options.some((o) => o.value === value) &&
                                        index === 0) ||
                                    undefined
                                }
                                onClick={() => {
                                    setOpen(false);
                                    if (
                                        option.value !== value &&
                                        trigger.current
                                    )
                                        onChange(option.value, trigger.current);
                                }}
                            >
                                <span>{option.label}</span>
                                {option.value === value ? (
                                    <svg
                                        aria-hidden="true"
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            d="m5 12 4 4 10-10"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                        />
                                    </svg>
                                ) : null}
                            </button>
                        ))}
                        {!filtered.length ? (
                            <p role="status">
                                No matching options. Try another search.
                            </p>
                        ) : null}
                    </div>
                </TvDialog>
            ) : null}
        </>
    );
}
