import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

const noop = () => {
  // intentionally empty for test stubs
};

describe('DeleteConfirmDialog', () => {
  it('renders confirmation question and action buttons when open', () => {
    render(<DeleteConfirmDialog open onCancel={noop} onConfirm={noop} />);
    expect(screen.getByRole('heading', { name: /Видалити чек/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Скасувати/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Так, видалити/i })).toBeInTheDocument();
  });

  it('calls onCancel when Cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog open onCancel={onCancel} onConfirm={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Скасувати/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onConfirm when Delete button clicked', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog open onCancel={noop} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Так, видалити/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('disables both buttons and shows pending label while pending', () => {
    render(<DeleteConfirmDialog open pending onCancel={noop} onConfirm={noop} />);
    expect(screen.getByRole('button', { name: /Скасувати/i })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: /Видаляю.../i });
    expect(confirm).toBeDisabled();
  });
});
