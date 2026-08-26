// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const saveGameModeChoice = vi.fn();
const navigate = vi.fn();

vi.mock('../lib/gameSession', () => ({
  saveGameModeChoice: (...a: unknown[]) => saveGameModeChoice(...a),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../components/cat/CatSprite', () => ({ default: () => null }));
vi.mock('../components/cat/MusicToggle', () => ({ default: () => null }));
vi.mock('../components/cat/useMusic', () => ({ useMusic: () => {} }));

import GameModeSelectPage from './GameModeSelectPage';
import type { GameSession } from '../types/catGame.types';

const session = {
  id: 'game_abc',
  batchId: 'b1',
  status: 'open',
  items: [],
  createdAt: new Date(),
} as unknown as GameSession;

function renderPage(preview: boolean) {
  return render(
    <MemoryRouter>
      <GameModeSelectPage
        session={session}
        nickname="Dr Somchai"
        playerUid="lecturer-uid-1"
        avatar="cat"
        preview={preview}
      />
    </MemoryRouter>,
  );
}

async function pickAModeAndStart() {
  const user = userEvent.setup();
  await user.click(screen.getByText('Match & Treat'));
  await user.click(screen.getByRole('button', { name: /Let's Go/ }));
}

afterEach(cleanup);
beforeEach(() => {
  saveGameModeChoice.mockReset();
  saveGameModeChoice.mockResolvedValue(undefined);
  navigate.mockReset();
});

describe('GameModeSelectPage in preview', () => {
  /**
   * gameModeStats is class data — which modes the students chose. A lecturer
   * trying all three to see what they look like would read as three students.
   */
  it("does not count the creator's mode choice", async () => {
    renderPage(true);
    await pickAModeAndStart();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(saveGameModeChoice).not.toHaveBeenCalled();
  });

  it('carries preview into the game on router state, not the URL', async () => {
    renderPage(true);
    await pickAModeAndStart();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const [path, options] = navigate.mock.calls[0];
    expect(options.state.preview).toBe(true);
    // The one channel a non-creator could forge must stay clean.
    expect(String(path)).not.toContain('preview');
  });

  it("still counts a real student's mode choice", async () => {
    renderPage(false);
    await pickAModeAndStart();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(saveGameModeChoice).toHaveBeenCalledWith('game_abc', 'matching');
    expect(navigate.mock.calls[0][1].state.preview).toBe(false);
  });
});
