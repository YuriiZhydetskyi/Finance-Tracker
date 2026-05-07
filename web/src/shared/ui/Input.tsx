import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './cn';

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100',
        className,
      )}
      {...rest}
    />
  );
});
