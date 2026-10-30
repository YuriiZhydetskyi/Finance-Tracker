import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AttributesPanel } from './AttributesPanel';

const APPLE = { Сорт: 'Jonagold', Калібр: '65–70 мм', 'Країна походження': 'Німеччина' };

function renderPanel(
  attributes: Record<string, string>,
  overrides: Partial<Parameters<typeof AttributesPanel>[0]> = {},
) {
  const onChange = vi
    .fn<(next: Record<string, string>) => Promise<unknown>>()
    .mockResolvedValue(undefined);
  render(
    <AttributesPanel
      attributes={attributes}
      legacyNote={null}
      saving={false}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

describe('AttributesPanel', () => {
  it('lists every pair under «Інше», alphabetically', () => {
    renderPanel(APPLE);
    expect(screen.getByRole('heading', { name: 'Інше' })).toBeInTheDocument();
    expect(screen.getByText('Jonagold')).toBeInTheDocument();
    expect(screen.getByText('65–70 мм')).toBeInTheDocument();
    const names = screen.getAllByRole('term').map((term) => term.textContent);
    expect(names).toEqual(['Калібр', 'Країна походження', 'Сорт']);
  });

  it('says so when nothing is recorded, and still offers to add', () => {
    renderPanel({});
    expect(screen.getByText('Нічого не внесено.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Додати пункт' })).toBeEnabled();
  });

  it('shows the legacy free-text note read-only as «Примітка»', () => {
    renderPanel({}, { legacyNote: 'Сорт на ціннику не вказано' });
    expect(screen.getByText('Примітка')).toBeInTheDocument();
    expect(screen.getByText('Сорт на ціннику не вказано')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Змінити: Примітка/ })).not.toBeInTheDocument();
  });

  it('shows no «Примітка» row without a legacy note', () => {
    renderPanel(APPLE);
    expect(screen.queryByText('Примітка')).not.toBeInTheDocument();
  });

  it('adds a pair after trimming it', async () => {
    const { onChange } = renderPanel({ Сорт: 'Jonagold' });
    fireEvent.click(screen.getByRole('button', { name: 'Додати пункт' }));
    fireEvent.change(screen.getByLabelText('Нова назва'), { target: { value: ' Клас ' } });
    fireEvent.change(screen.getByLabelText('Нове значення'), { target: { value: ' I ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ Сорт: 'Jonagold', Клас: 'I' }));
    await waitFor(() => expect(screen.queryByLabelText('Нова назва')).not.toBeInTheDocument());
  });

  it('suggests the names the import prompt uses', () => {
    renderPanel({});
    fireEvent.click(screen.getByRole('button', { name: 'Додати пункт' }));
    const listId = screen.getByLabelText('Нова назва').getAttribute('list');
    const options = Array.from(
      document.getElementById(listId ?? '')?.querySelectorAll('option') ?? [],
    );
    expect(options.map((option) => option.value)).toContain('Країна походження');
  });

  it('refuses a second pair with the same name, ignoring case', () => {
    const { onChange } = renderPanel({ Сорт: 'Jonagold' });
    fireEvent.click(screen.getByRole('button', { name: 'Додати пункт' }));
    fireEvent.change(screen.getByLabelText('Нова назва'), { target: { value: 'сорт' } });
    fireEvent.change(screen.getByLabelText('Нове значення'), { target: { value: 'Gala' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Така назва вже є');
    expect(screen.getByRole('button', { name: 'Додати' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not allow a blank name or value', () => {
    renderPanel({});
    fireEvent.click(screen.getByRole('button', { name: 'Додати пункт' }));
    fireEvent.change(screen.getByLabelText('Нова назва'), { target: { value: 'Клас' } });
    fireEvent.change(screen.getByLabelText('Нове значення'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Додати' })).toBeDisabled();
  });

  it('changes the value of a pair and keeps the others', async () => {
    const { onChange } = renderPanel(APPLE);
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Сорт' }));
    fireEvent.change(screen.getByLabelText('Значення пункту'), { target: { value: ' Gala ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...APPLE, Сорт: 'Gala' }));
  });

  it('renames a pair without leaving the old name behind', async () => {
    const { onChange } = renderPanel({ Сорт: 'Jonagold' });
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Сорт' }));
    fireEvent.change(screen.getByLabelText('Назва пункту'), { target: { value: 'Різновид' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ Різновид: 'Jonagold' }));
  });

  it('lets a pair keep its own name while it is edited, and refuses another pair’s name', () => {
    renderPanel(APPLE);
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Сорт' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Назва пункту'), { target: { value: 'калібр' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
  });

  it('removes only the chosen pair', () => {
    const { onChange } = renderPanel(APPLE);
    fireEvent.click(screen.getByRole('button', { name: 'Видалити: Калібр' }));
    expect(onChange).toHaveBeenCalledWith({ Сорт: 'Jonagold', 'Країна походження': 'Німеччина' });
  });

  it('removing the last pair clears the section', () => {
    const { onChange } = renderPanel({ Сорт: 'Jonagold' });
    fireEvent.click(screen.getByRole('button', { name: 'Видалити: Сорт' }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('cancelling an edit changes nothing', () => {
    const { onChange } = renderPanel({ Сорт: 'Jonagold' });
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Сорт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Jonagold')).toBeInTheDocument();
  });

  it('keeps the editor and its text open when saving fails', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('RLS denied'));
    renderPanel({ Сорт: 'Jonagold' }, { onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Змінити: Сорт' }));
    fireEvent.change(screen.getByLabelText('Значення пункту'), { target: { value: 'Інакше' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.getByLabelText('Значення пункту')).toHaveValue('Інакше');
  });

  it('disables every action while saving', () => {
    renderPanel({ Сорт: 'Jonagold' }, { saving: true });
    expect(screen.getByRole('button', { name: 'Змінити: Сорт' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Видалити: Сорт' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Додати пункт' })).toBeDisabled();
  });

  it('stops offering new pairs at the per-card limit', () => {
    renderPanel(
      Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`Ключ ${String(i)}`, 'значення'])),
    );
    expect(screen.getByRole('button', { name: 'Додати пункт' })).toBeDisabled();
  });
});
