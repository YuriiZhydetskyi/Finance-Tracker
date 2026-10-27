import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewNotesPanel } from './ReviewNotesPanel';

function renderPanel(
  notes: string[],
  overrides: Partial<Parameters<typeof ReviewNotesPanel>[0]> = {},
) {
  const onChange = vi.fn<(next: string[]) => Promise<unknown>>().mockResolvedValue(undefined);
  render(<ReviewNotesPanel notes={notes} saving={false} onChange={onChange} {...overrides} />);
  return { onChange };
}

describe('ReviewNotesPanel', () => {
  it('shows a prominent block listing every reason', () => {
    renderPanel(['Штрихкод розмитий', 'Немає звороту']);
    expect(screen.getByRole('heading', { name: 'Потрібна перевірка' })).toBeInTheDocument();
    expect(screen.getByText('Штрихкод розмитий')).toBeInTheDocument();
    expect(screen.getByText('Немає звороту')).toBeInTheDocument();
  });

  it('marks one note as checked, which removes only that note', () => {
    const { onChange } = renderPanel(['Штрихкод розмитий', 'Немає звороту']);
    fireEvent.click(screen.getByRole('button', { name: 'Перевірено: Штрихкод розмитий' }));
    expect(onChange).toHaveBeenCalledWith(['Немає звороту']);
  });

  it('marking the last note clears the list', () => {
    const { onChange } = renderPanel(['Єдина причина']);
    fireEvent.click(screen.getByRole('button', { name: 'Перевірено: Єдина причина' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('marks everything as checked in one click', () => {
    const { onChange } = renderPanel(['Перша', 'Друга', 'Третя']);
    fireEvent.click(screen.getByRole('button', { name: 'Позначити все перевіреним' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('edits a note in place and keeps the others', async () => {
    const { onChange } = renderPanel(['Перша', 'Друга']);
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Друга' }));
    fireEvent.change(screen.getByLabelText('Текст примітки'), {
      target: { value: '  Друга, уточнено ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Перша', 'Друга, уточнено']));
    await waitFor(() => expect(screen.queryByLabelText('Текст примітки')).not.toBeInTheDocument());
  });

  it('does not allow saving a blank edit', () => {
    renderPanel(['Перша']);
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Перша' }));
    fireEvent.change(screen.getByLabelText('Текст примітки'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
  });

  it('cancelling an edit changes nothing', () => {
    const { onChange } = renderPanel(['Перша']);
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Перша' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Перша')).toBeInTheDocument();
  });

  it('adds a note after the existing ones and ignores a duplicate', async () => {
    const { onChange } = renderPanel(['Перша']);
    fireEvent.click(screen.getByRole('button', { name: 'Додати примітку' }));
    fireEvent.change(screen.getByLabelText('Нова примітка до перевірки'), {
      target: { value: ' Нова причина ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Перша', 'Нова причина']));

    fireEvent.click(screen.getByRole('button', { name: 'Додати примітку' }));
    fireEvent.change(screen.getByLabelText('Нова примітка до перевірки'), {
      target: { value: 'перша' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['Перша']));
  });

  it('keeps the editor and its text open when saving fails', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('RLS denied'));
    renderPanel(['Перша'], { onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Перша' }));
    fireEvent.change(screen.getByLabelText('Текст примітки'), { target: { value: 'Інакше' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.getByLabelText('Текст примітки')).toHaveValue('Інакше');
  });

  it('disables every action while saving', () => {
    renderPanel(['Перша'], { saving: true });
    expect(screen.getByRole('button', { name: 'Перевірено: Перша' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Змінити: Перша' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Позначити все перевіреним' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Додати примітку' })).toBeDisabled();
  });

  it('stops offering new notes at the per-card limit', () => {
    renderPanel(Array.from({ length: 50 }, (_, i) => `Причина ${String(i)}`));
    expect(screen.getByRole('button', { name: 'Додати примітку' })).toBeDisabled();
  });

  describe('without notes', () => {
    it('shows no warning block, only a quiet way to flag the card', () => {
      renderPanel([]);
      expect(screen.queryByRole('heading', { name: 'Потрібна перевірка' })).not.toBeInTheDocument();
      expect(screen.getByText('Перевірка не потрібна.')).toBeInTheDocument();
    });

    it('lets the owner flag the card by adding the first note', async () => {
      const { onChange } = renderPanel([]);
      fireEvent.click(screen.getByRole('button', { name: 'Позначити для перевірки' }));
      fireEvent.change(screen.getByLabelText('Нова примітка до перевірки'), {
        target: { value: 'Звірити смак' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Звірити смак']));
    });
  });
});
