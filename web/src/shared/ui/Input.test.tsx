import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { Input } from './Input';

describe('Input', () => {
  it('defaults to a text input and merges the class name', () => {
    render(<Input aria-label="Назва" className="extra" />);
    const input = screen.getByLabelText('Назва');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveClass('extra', 'h-10');
  });

  it('passes ref through as a prop', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Назва" />);
    expect(ref.current).toBe(screen.getByLabelText('Назва'));
  });

  it('keeps react-hook-form register working', async () => {
    const user = userEvent.setup();
    let getValue: () => string = () => '';

    function Harness() {
      const { register, getValues } = useForm<{ store: string }>({
        defaultValues: { store: 'Edeka' },
      });
      getValue = () => getValues('store');
      return <Input aria-label="Магазин" {...register('store')} />;
    }

    render(<Harness />);
    const input = screen.getByLabelText('Магазин');
    expect(input).toHaveValue('Edeka');

    await user.clear(input);
    await user.type(input, 'Lidl');

    expect(getValue()).toBe('Lidl');
  });
});
