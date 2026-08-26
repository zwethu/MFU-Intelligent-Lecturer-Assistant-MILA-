// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getGameSession = vi.fn();
const checkStudentAccess = vi.fn();
const getPlayerProfile = vi.fn();
const getAttempt = vi.fn();
const createPlayerProfile = vi.fn();

vi.mock('../lib/gameSession', () => ({
  getGameSession: (...a: unknown[]) => getGameSession(...a),
  checkStudentAccess: (...a: unknown[]) => checkStudentAccess(...a),
  getPlayerProfile: (...a: unknown[]) => getPlayerProfile(...a),
  getAttempt: (...a: unknown[]) => getAttempt(...a),
  createPlayerProfile: (...a: unknown[]) => createPlayerProfile(...a),
}));

// Auth is faked rather than mocked away entirely: the whole feature turns on
// comparing the signed-in uid to the game's lecturerId.
let currentUser: { uid: string; email: string; displayName?: string } | null = null;

vi.mock('../lib/firebase', () => ({
  auth: {
    get currentUser() {
      return currentUser;
    },
    onAuthStateChanged: (cb: (u: unknown) => void) => {
      cb(currentUser);
      return () => {};
    },
  },
}));

vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  signOut: vi.fn(),
}));

// The buddy picker pulls audio and lottie; the preview flow lands on it, and none
// of that is what these tests are about.
vi.mock('./AvatarSelectPage', () => ({
  default: () => <div data-testid="avatar-select">Pick your buddy</div>,
}));
vi.mock('./GameModeSelectPage', () => ({
  default: () => <div data-testid="mode-select">Pick a mode</div>,
}));
vi.mock('../components/cat/CatSprite', () => ({ default: () => null }));
vi.mock('../components/cat/CertificateModal', () => ({ default: () => null }));

import PlayEntryPage from './PlayEntryPage';

const LECTURER = 'lecturer-uid-1';
const STUDENT = 'student-uid-9';

const session = (over: Record<string, unknown> = {}) => ({
  id: 'game_abc',
  batchId: 'b1',
  status: 'open',
  title: 'Software Project Management Fundamentals',
  lecturerId: LECTURER,
  items: [{ id: 'item_1', term: 'A', definition: 'B' }],
  createdAt: new Date(),
  ...over,
});

const past = () => new Date(Date.now() - 86_400_000).toISOString();

function renderPlay() {
  return render(
    <MemoryRouter initialEntries={['/play/game_abc']}>
      <Routes>
        <Route path="/play/:assessmentId" element={<PlayEntryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  currentUser = null;
});

beforeEach(() => {
  getGameSession.mockReset();
  checkStudentAccess.mockReset();
  getPlayerProfile.mockReset();
  getAttempt.mockReset();
  createPlayerProfile.mockReset();
  getGameSession.mockResolvedValue(session());
  checkStudentAccess.mockResolvedValue(false);
  getPlayerProfile.mockResolvedValue(null);
  getAttempt.mockResolvedValue(null);
});

describe('the creator previewing their own game', () => {
  /**
   * The bug that started this: a lecturer is never on their own class roster, so
   * opening their own link refused them with "Not Enrolled".
   */
  it('is let in even though they are not on the roster', async () => {
    currentUser = { uid: LECTURER, email: 'lecturer@example.com', displayName: 'Dr Somchai' };
    renderPlay();

    expect(await screen.findByTestId('avatar-select')).toBeTruthy();
    expect(screen.queryByText('Not Enrolled')).toBeNull();
  });

  it('says plainly that nothing is being recorded', async () => {
    currentUser = { uid: LECTURER, email: 'lecturer@example.com' };
    renderPlay();
    await screen.findByTestId('avatar-select');

    expect(screen.getByRole('status').textContent).toContain('results are not saved');
  });

  it('names the game and offers a way back to its details page', async () => {
    currentUser = { uid: LECTURER, email: 'lecturer@example.com' };
    renderPlay();
    await screen.findByTestId('avatar-select');

    expect(screen.getByRole('status').textContent).toContain(
      'Software Project Management Fundamentals',
    );
    expect(
      screen.getByRole('link', { name: /Back to game details/ }).getAttribute('href'),
    ).toBe('/batches/b1/games/game_abc');
  });

  /**
   * This is the assertion that pins "a preview writes nothing".
   *
   * Two of the five write paths are suppressed by never being entered at all:
   * the nickname screen (which would create a players/{uid} doc for a lecturer)
   * and the attempt lookup (which would lock them out of ever previewing again,
   * since attempts have no update or delete rule).
   */
  it('never touches the roster, the profile, or the attempt record', async () => {
    currentUser = { uid: LECTURER, email: 'lecturer@example.com' };
    renderPlay();
    await screen.findByTestId('avatar-select');

    expect(checkStudentAccess).not.toHaveBeenCalled();
    expect(getPlayerProfile).not.toHaveBeenCalled();
    expect(getAttempt).not.toHaveBeenCalled();
    expect(createPlayerProfile).not.toHaveBeenCalled();
  });

  it('can preview a game that is closed to students', async () => {
    getGameSession.mockResolvedValue(session({ status: 'closed' }));
    currentUser = { uid: LECTURER, email: 'lecturer@example.com' };
    renderPlay();

    expect(await screen.findByTestId('avatar-select')).toBeTruthy();
    expect(screen.queryByText('Not Available')).toBeNull();
  });

  it('can preview a game whose deadline has passed', async () => {
    getGameSession.mockResolvedValue(session({ deadlineAt: past() }));
    currentUser = { uid: LECTURER, email: 'lecturer@example.com' };
    renderPlay();

    expect(await screen.findByTestId('avatar-select')).toBeTruthy();
    expect(screen.queryByText('Deadline Passed')).toBeNull();
  });

  it('can preview twice — a first preview leaves nothing to lock them out', async () => {
    currentUser = { uid: LECTURER, email: 'lecturer@example.com' };
    renderPlay();
    await screen.findByTestId('avatar-select');
    cleanup();

    renderPlay();
    expect(await screen.findByTestId('avatar-select')).toBeTruthy();
    expect(screen.queryByText(/already played/i)).toBeNull();
  });
});

describe('everyone who is not the creator', () => {
  it('still gets Not Enrolled when off the roster', async () => {
    currentUser = { uid: STUDENT, email: 'someone@example.com' };
    renderPlay();

    expect(await screen.findByText('Not Enrolled')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('still gets Not Available on a closed game', async () => {
    getGameSession.mockResolvedValue(session({ status: 'closed' }));
    currentUser = { uid: STUDENT, email: 'someone@example.com' };
    renderPlay();

    expect(await screen.findByText('Not Available')).toBeTruthy();
  });

  it('still gets Deadline Passed once the due date is behind them', async () => {
    getGameSession.mockResolvedValue(session({ deadlineAt: past() }));
    currentUser = { uid: STUDENT, email: 'someone@example.com' };
    renderPlay();

    expect(await screen.findByText('Deadline Passed')).toBeTruthy();
  });

  it('is admitted normally when they ARE on the roster', async () => {
    checkStudentAccess.mockResolvedValue(true);
    getPlayerProfile.mockResolvedValue({ uid: STUDENT, nickname: 'Speedy' });
    currentUser = { uid: STUDENT, email: 'someone@example.com' };
    renderPlay();

    expect(await screen.findByTestId('avatar-select')).toBeTruthy();
    // A student's screens carry no preview strip.
    expect(screen.queryByRole('status')).toBeNull();
    expect(checkStudentAccess).toHaveBeenCalledWith('b1', 'someone@example.com');
  });

  it('sees the closed screen rather than a login prompt when signed out', async () => {
    getGameSession.mockResolvedValue(session({ status: 'closed' }));
    currentUser = null;
    renderPlay();

    expect(await screen.findByText('Not Available')).toBeTruthy();
  });
});

describe('a game with no creator recorded', () => {
  /**
   * Games created before lecturerId existed carry no owner. A missing value must
   * read as "nobody", never as "everybody" — otherwise any signed-in visitor whose
   * uid compared equal to undefined would walk past the roster gate.
   */
  it('grants preview to nobody', async () => {
    getGameSession.mockResolvedValue(session({ lecturerId: undefined }));
    currentUser = { uid: STUDENT, email: 'someone@example.com' };
    renderPlay();

    expect(await screen.findByText('Not Enrolled')).toBeTruthy();
  });
});
