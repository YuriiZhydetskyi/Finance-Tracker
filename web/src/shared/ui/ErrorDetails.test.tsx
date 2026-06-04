import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ErrorDetails } from './ErrorDetails';

describe('ErrorDetails', () => {
  it('renders the message with an optional label', () => {
    render(<ErrorDetails error={new Error('boom')} label="Помилка збереження" />);
    expect(screen.getByText('Помилка збереження: boom')).toBeInTheDocument();
  });

  it('renders just the message when no label', () => {
    render(<ErrorDetails error="plain" />);
    expect(screen.getByText('plain')).toBeInTheDocument();
  });

  it('exposes code/hint in the technical detail block for a Postgrest error', () => {
    const pg = { message: 'denied', code: '42501', hint: 'check RLS' };
    render(<ErrorDetails error={pg} />);
    expect(screen.getByText('Технічні деталі')).toBeInTheDocument();
    expect(screen.getByText(/код: 42501/)).toBeInTheDocument();
    expect(screen.getByText(/підказка: check RLS/)).toBeInTheDocument();
  });

  it('hides the detail block when there is nothing beyond the message', () => {
    render(<ErrorDetails error="just a message" />);
    expect(screen.queryByText('Технічні деталі')).not.toBeInTheDocument();
  });

  it('copies the serialized detail to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ErrorDetails error={{ message: 'denied', code: '42501' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Копіювати/i }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain('код: 42501');
  });
});
