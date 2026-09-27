import type { ComponentProps } from 'react';
import { cn } from './cn';
import { fieldControlClass } from './variants';

/*
 * shadcn/ui Label, Input, Textarea and Native Select. Label is a plain
 * `<label>` (upstream wraps @radix-ui/react-label, which only adds
 * double-click text-selection prevention) and Select is the native element,
 * to keep the dependency list to what ADR-023 records.
 */

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    // Callers pass `htmlFor` (or wrap the control); the rule cannot see through props.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="label"
      className={cn('flex items-center gap-2 text-sm leading-none font-medium', className)}
      {...props}
    />
  );
}

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        fieldControlClass,
        'h-9 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldControlClass, 'min-h-16 py-2', className)}
      {...props}
    />
  );
}

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(fieldControlClass, 'h-9', className)}
      {...props}
    />
  );
}

/** A small muted line under a field or heading. */
export function FieldHint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
