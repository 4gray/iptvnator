import { Pipe, PipeTransform } from '@angular/core';
import moment from 'moment';

/**
 * Moment.js based pipe to parse and return the provided date based on given params.
 * Auto-detects ISO 8601 format and converts to user's local timezone.
 * Optionally accepts a format string for non-ISO date strings.
 */
@Pipe({
    name: 'momentDate',
    standalone: true,
})
export class MomentDatePipe implements PipeTransform {
    transform(
        value: string,
        formatToReturn = 'MMMM Do, dddd',
        formatToParse?: string
    ): string {
        // If formatToParse is provided, use it; otherwise auto-detect (works for ISO 8601)
        const parsed = formatToParse
            ? moment(value, formatToParse)
            : moment(value);
        return parsed.format(formatToReturn);
    }
}
