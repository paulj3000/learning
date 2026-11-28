import { fireEvent, screen } from '@testing-library/react';

/**
 * GE-101: opens the stage's "Things to do" menu (closed by default) and returns its panel.
 * Already open: left as it is. Call it before reading the exploration list, including before a
 * "not in the list" check, which would otherwise pass only because the list is closed.
 */
export async function openThingsToDo(): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name: 'Things to do' });
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button);
  return screen.getByRole('dialog', { name: 'Things to do here' });
}
