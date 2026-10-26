import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Скасувати</Button>);
    expect(screen.getByRole('button', { name: 'Скасувати' })).toHaveAttribute('type', 'button');
  });

  it('applies the variant and merges the class name', () => {
    render(
      <Button variant="danger" className="ml-auto">
        Видалити
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Видалити' })).toHaveClass('bg-red-600', 'ml-auto');
  });

  it('passes ref through as a prop', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Зберегти</Button>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Зберегти' }));
  });

  it('does not fire onClick while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Зберегти
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Зберегти' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
