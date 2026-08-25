import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Medal } from '@phosphor-icons/react';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  getGameSession,
  checkStudentAccess,
  getPlayerProfile,
  createPlayerProfile,
  getAttempt,
} from '../lib/gameSession';
import type { GameSession, AvatarType, StoredAttempt } from '../types/catGame.types';
import CatSprite from '../components/cat/CatSprite';
import CertificateModal from '../components/cat/CertificateModal';
import { computeMedal } from '../components/cat/medal';
import { formatDate, formatDateTime, toDate } from '../utils/formatDate';
import AvatarSelectPage from './AvatarSelectPage';
import GameModeSelectPage from './GameModeSelectPage';
import PreviewBanner from '../components/cat/PreviewBanner';
import './PlayEntryPage.css';

/**
 * Wraps a play screen in the preview strip when the viewer is the game's creator,
 * and gets out of the way entirely otherwise — a student's markup is untouched.
 */
function PreviewFrame({
  preview,
  session,
  children,
}: {
  preview: boolean;
  session: GameSession | null;
  children: React.ReactNode;
}) {
  if (!preview) return <>{children}</>;
  return (
    <div className="has-preview-banner">
      <PreviewBanner
        title={session?.title}
        backTo={session ? `/batches/${session.batchId}/games/${session.id}` : undefined}
      />
      {children}
    </div>
  );
}

/**
 * A game is out of time once its lecturer-set deadline has passed. Checked on entry
 * only: a student already mid-round keeps their round, because the alternative is
 * voiding work that was legitimately started before the bell.
 */
function deadlinePassed(session: GameSession): boolean {
  const due = toDate(session.deadlineAt);
  return due !== null && due.getTime() <= Date.now();
}

type FlowStep =
  | 'loading'
  | 'invalid'
  | 'unavailable'
  | 'past_deadline'
  | 'login'
  | 'checking_access'
  | 'not_enrolled'
  | 'nickname'
  | 'already_played'
  | 'avatar_select'  // NEW — pick cat/dog buddy
  | 'mode_select'
  | 'ready';

export default function PlayEntryPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();

  const [step, setStep] = useState<FlowStep>('loading');
  const [session, setSession] = useState<GameSession | null>(null);
  const [nickname, setNickname] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userUid, setUserUid] = useState('');
  const [avatar, setAvatar] = useState<AvatarType | null>(null);
  const [storedAttempt, setStoredAttempt] = useState<StoredAttempt | null>(null);
  const [certOpen, setCertOpen] = useState(false);
  // The lecturer who made this game, walking through it themselves. Everything it
  // controls is downstream of one identity check in the effect below.
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!assessmentId) { setStep('invalid'); return; }
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    getGameSession(assessmentId)
      .then(s => {
        if (cancelled) return;
        if (!s) { setStep('invalid'); return; }
        setSession(s);

        // Held as a VALUE rather than spent with an early return. These two gates
        // used to fire before auth resolved, which made them unreachable for the one
        // visitor who is allowed past them: the lecturer who made the game, checking
        // it before reopening it. A student's experience is unchanged — the verdict
        // is simply not rendered until we know who is asking.
        // 'active' is the spelling games created before the status fix carry.
        const blocked: FlowStep | null =
          s.status !== 'open' && s.status !== 'active' ? 'unavailable'
          : deadlinePassed(s) ? 'past_deadline'
          : null;

        unsubscribe = auth.onAuthStateChanged(user => {
          // uid, not email: lecturerId is written from the Firebase Auth uid, and the
          // teacher and player apps share one project, so the subject is the same.
          // A game created before lecturerId existed has none, and a missing value
          // must read as "nobody" rather than "everybody" — hence the Boolean guard.
          const isCreator = Boolean(s.lecturerId) && s.lecturerId === user?.uid;
          if (blocked && !isCreator) { setStep(blocked); return; }
          if (user && user.email) {
            setUserEmail(user.email);
            setUserUid(user.uid);
            handlePostLogin(s, user.uid, user.email, isCreator);
          } else {
            setStep('login');
          }
        });
      })
      .catch(() => { if (!cancelled) setStep('invalid'); });

    // The listener used to be returned from inside .then(), where the promise
    // swallowed it — this effect's cleanup was undefined and the subscription
    // outlived the page.
    return () => { cancelled = true; unsubscribe?.(); };
  }, [assessmentId]);

  async function handlePostLogin(s: GameSession, uid: string, email: string, isCreator: boolean) {
    // The creator is not a student and must not be walked through the student path:
    //   - the roster query would refuse them (they are not on their own roster),
    //   - the nickname screen would CREATE a players/{uid} profile for a lecturer,
    //   - and the attempt lookup would lock them out of ever previewing again,
    //     because attempts have no update or delete rule to undo the first one.
    // Returning here is what makes a preview run write nothing at all.
    if (isCreator) {
      setPreview(true);
      setNickname(auth.currentUser?.displayName || 'Preview');
      setStep('avatar_select');
      return;
    }

    setStep('checking_access');
    try {
      const allowed = await checkStudentAccess(s.batchId, email);
      if (!allowed) { setStep('not_enrolled'); return; }

      const profile = await getPlayerProfile(uid);

      const attempt = await getAttempt(s.id, uid);
      if (attempt) {
        // Already played — keep the record so they can re-issue their certificate.
        setStoredAttempt(attempt);
        if (profile?.nickname) setNickname(profile.nickname);
        setStep('already_played');
        return;
      }

      if (!profile || !profile.nickname) {
        setStep('nickname');
      } else {
        setNickname(profile.nickname);
        setStep('avatar_select'); // pick buddy, then mode
      }
    } catch {
      setStep('invalid');
    }
  }

  async function handleGoogleSignIn() {
    try {
      const provider = new GoogleAuthProvider();
      // Force the account chooser. Without it Google silently reuses the one
      // account already signed into the browser, so "use a different account"
      // would land the student straight back on the screen they left.
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      if (!user.email || !session) return;
      setUserEmail(user.email);
      setUserUid(user.uid);
      // Same identity test as the entry effect. A creator who arrives signed out
      // and signs in here is still the creator, and must land in preview rather
      // than being bounced off their own roster.
      handlePostLogin(
        session,
        user.uid,
        user.email,
        Boolean(session.lecturerId) && session.lecturerId === user.uid,
      );
    } catch (err) {
      // Usually the user closing the popup — but log it, because real
      // failures (popup blocked, redirect_uri_mismatch, network) land
      // here too and used to disappear without a trace.
      console.error('[login] Google sign-in failed:', err);
    }
  }

  async function handleNicknameSubmit() {
    const trimmed = nicknameInput.trim();
    if (!trimmed) { setNicknameError('Please enter a nickname 🐱'); return; }
    if (trimmed.length < 2) { setNicknameError('At least 2 characters please!'); return; }
    if (trimmed.length > 20) { setNicknameError('Max 20 characters!'); return; }
    setSaving(true);
    try {
      await createPlayerProfile(userUid, trimmed, userEmail);
      setNickname(trimmed);
      setStep('avatar_select'); // after nickname → pick buddy
    } catch {
      setNicknameError('Something went wrong, try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
    setStep('login');
    // Everything below is keyed to the account that just left. Clearing it
    // matters most on a shared phone: without it the next student inherits the
    // previous one's nickname and attempt record in memory.
    setUserEmail('');
    setUserUid('');
    setNickname('');
    setNicknameInput('');
    setNicknameError('');
    setStoredAttempt(null);
    setCertOpen(false);
    setAvatar(null);
  }

  // ─── Render ──────────────────────────────────────────────────

  if (step === 'loading' || step === 'checking_access') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="idle" />
          <p className="play-loading-text">{
            step === 'loading' ? 'Loading your adventure...' : 'Checking access...'
          }</p>
          <div className="play-spinner" />
        </div>
      </div>
    );
  }

  if (step === 'invalid') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="confused" />
          <h2 className="play-title">Oops!</h2>
          <p className="play-subtitle">This assessment link is invalid or doesn't exist.</p>
          <p className="play-hint">Ask your teacher for the correct link 🐾</p>
        </div>
      </div>
    );
  }

  if (step === 'unavailable') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="sleeping" />
          <h2 className="play-title">Not Available</h2>
          <p className="play-subtitle">This assessment is closed or has expired.</p>
          <p className="play-hint">Contact your teacher if you think this is a mistake 🐾</p>
        </div>
      </div>
    );
  }

  if (step === 'past_deadline') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="sleeping" />
          <h2 className="play-title">Deadline Passed</h2>
          <p className="play-subtitle">
            This game closed on <strong>{formatDateTime(session?.deadlineAt)}</strong>.
          </p>
          <p className="play-hint">Ask your teacher if you need more time 🐾</p>
        </div>
      </div>
    );
  }

  if (step === 'not_enrolled') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="confused" />
          <h2 className="play-title">Not Enrolled</h2>
          <p className="play-subtitle">Your email <strong>{userEmail}</strong> is not in this class.</p>
          <p className="play-hint">Make sure you're signed in with your school email 🐾</p>
          <button className="play-secondary-btn" onClick={handleSignOut}>
            Sign in with a different account
          </button>
        </div>
      </div>
    );
  }

  if (step === 'already_played') {
    const total = session?.items.length ?? storedAttempt?.score ?? 0;
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="happy" species={storedAttempt?.chosenAvatar} />
          <h2 className="play-title">Already Played!</h2>
          <p className="play-subtitle">You've already completed this assessment.</p>
          <p className="play-hint">Each assessment can only be played once 🐾</p>

          {storedAttempt && (
            <button className="play-primary-btn" onClick={() => setCertOpen(true)}>
              <Medal size={20} weight="duotone" /> Get My Certificate
            </button>
          )}
          <p className="play-footer-hint">Lost your certificate? Grab it again anytime ✨</p>

          {/* The one screen with no way onward and no back step to return to:
              buddy/mode select can route back to the nickname screen, and that
              screen's own back signs out. Here the only wrong turn worth undoing
              is the account itself, so it gets the explicit control. */}
          <button className="play-secondary-btn" onClick={handleSignOut}>
            Sign in with a different account
          </button>
        </div>

        {certOpen && storedAttempt && (
          <CertificateModal
            nickname={nickname || 'Player'}
            medal={computeMedal(storedAttempt.accuracy, storedAttempt.behavior)}
            correct={storedAttempt.score}
            total={total}
            accuracy={storedAttempt.accuracy}
            species={storedAttempt.chosenAvatar ?? 'cat'}
            dateStr={formatDate(storedAttempt.completedAt)}
            certId={storedAttempt.id}
            onClose={() => setCertOpen(false)}
          />
        )}
      </div>
    );
  }

  if (step === 'login') {
    return (
      <div className="play-entry-bg">
        <div className="play-entry-scene">
          <div className="play-scene-deco left">🌿</div>
          <div className="play-scene-deco right">🌿</div>
        </div>
        <div className="play-card">
          <CatSprite mood="idle" />
          <h2 className="play-title">Welcome, Scholar!</h2>
          <p className="play-subtitle">Sign in to begin your study adventure 🐾</p>
          <button className="play-google-btn" onClick={handleGoogleSignIn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
          <p className="play-footer-hint">Your adventure awaits, brave scholar ✨</p>
        </div>
      </div>
    );
  }

  if (step === 'nickname') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          {/* Root of the back chain: buddy select returns here, and here the
              previous step really is the sign-in screen — so back = sign out.
              Without it a student who picked the wrong Google account has no
              way off this screen. */}
          <button
            type="button"
            className="play-back-btn"
            onClick={handleSignOut}
            disabled={saving}
            aria-label="Back to sign in with a different account"
            title="Back to sign in with a different account"
          >
            <ArrowLeft size={18} weight="bold" />
          </button>
          <CatSprite mood="idle" />
          <h2 className="play-title">What's your name?</h2>
          <p className="play-subtitle">Choose a nickname — your cat will remember it! 🐾</p>
          {/* The one honest line about what playing records. Shown before the
              first thing the student types, not buried after the game. */}
          <p className="play-privacy-note">
            Your teacher will see your name, school email, nickname, your answers and
            score, and how you played — including how long each round took. It's used
            to help with your learning, not to catch you out.
          </p>
          <div className="play-input-wrap">
            {/* No `name` attribute, and autofill off: this is a shared-device
                flow, so the browser must not offer the last student's nickname
                (or the device owner's saved names) to the next player. */}
            <input
              className="play-nickname-input"
              type="text"
              placeholder="e.g. StarStudent, MoonCat..."
              value={nicknameInput}
              onChange={e => { setNicknameInput(e.target.value); setNicknameError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleNicknameSubmit()}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            {nicknameError && <p className="play-input-error">{nicknameError}</p>}
          </div>
          <button
            className="play-primary-btn"
            onClick={handleNicknameSubmit}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Let\'s Go! 🐾'}
          </button>
        </div>
      </div>
    );
  }

  // step === 'avatar_select' — pick cat/dog buddy inline
  if (step === 'avatar_select') {
    return (
      <PreviewFrame preview={preview} session={session}>
        <AvatarSelectPage
          nickname={nickname}
          onSelect={a => { setAvatar(a); setStep('mode_select'); }}
          // Back from the first choice means "that's not the name I wanted" —
          // the nickname screen re-saves the profile, so it doubles as an edit.
          // A previewing lecturer has no profile to edit, so they get no way back
          // to a screen that would create one.
          onBack={preview ? undefined : () => { setNicknameInput(nickname); setStep('nickname'); }}
        />
      </PreviewFrame>
    );
  }

  // step === 'mode_select' — render the mode picker inline
  if (step === 'mode_select' && session && avatar) {
    return (
      <PreviewFrame preview={preview} session={session}>
        <GameModeSelectPage
          session={session}
          nickname={nickname}
          playerUid={userUid}
          avatar={avatar}
          preview={preview}
          onBack={() => setStep('avatar_select')}
        />
      </PreviewFrame>
    );
  }

  // fallback
  return null;
}
