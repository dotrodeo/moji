import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from './useGame.js';
import { getStoredAvatar, getStoredName, tokenRoomCode } from './session.js';
import { Landing } from './screens/Landing.js';
import { Join } from './screens/Join.js';
import { LobbyScreen } from './screens/Lobby.js';
import { RoundIntro, PromptAssignment } from './screens/Prompt.js';
import { ClueScreen } from './screens/Create.js';
import { GuessScreen } from './screens/Guess.js';
import { RevealScreen } from './screens/Reveal.js';
import { Leaderboard } from './screens/Leaderboard.js';
import { Winner } from './screens/Winner.js';
import { DealingSolo, JoiningNextRound, OpenElsewhere, SplashScreen } from './screens.js';

type PreGameRoute = 'landing' | 'create' | 'join' | 'solo';

export default function App() {
  const game = useGame();
  const { view, error, clearError, connected, hasConnected, unreachable, roomLost, notice, clearNotice } =
    game;
  // Capture the URL on first render, before the URL-sync effect can change it.
  const initialPath = useRef(window.location.pathname);
  const initialCode = useRef(window.location.pathname.match(/^\/r\/([0-9A-Za-z]+)/)?.[1]?.toUpperCase());
  // Start on the route the URL implies. Starting on 'landing' let the URL-sync
  // effect rewrite /r/CODE to / before the switch to 'join', so a reload of
  // the Join screen lost its code (and the landing page flashed first).
  const [route, setRouteState] = useState<PreGameRoute>(() =>
    initialPath.current === '/solo' ? 'solo' : initialCode.current ? 'join' : 'landing',
  );
  const [prefillCode, setPrefillCode] = useState(initialCode.current ?? '');

  /**
   * Leaving the landing page for a form adds a history entry, so the phone's
   * Back button returns to the landing page instead of leaving the site.
   */
  const routeRef = useRef(route);
  routeRef.current = route;
  const setRoute = useCallback((next: PreGameRoute) => {
    if (routeRef.current === 'landing' && (next === 'create' || next === 'join')) {
      window.history.pushState({ moji: 'form' }, '', '/');
    }
    routeRef.current = next;
    setRouteState(next);
  }, []);

  // One click from anywhere: /solo deals a game against the bot immediately,
  // so a link can drop someone straight into playing.
  const startSolo = useCallback(() => {
    setRoute('solo');
    void game.joinSolo(getStoredName() || 'You', getStoredAvatar()).catch(() => setRoute('landing'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On load with /r/<CODE>: silently rejoin if it's the room our token is for
  // (e.g. an accidental refresh), otherwise open Join with the code pre-filled.
  useEffect(() => {
    if (initialPath.current === '/solo') {
      startSolo();
      return;
    }
    const code = initialCode.current;
    if (!code) return;
    if (tokenRoomCode() === code) {
      void game.join(getStoredName() || 'Player', getStoredAvatar(), code).catch(() => {
        setPrefillCode(code);
        setRoute('join');
      });
    } else {
      setPrefillCode(code);
      setRoute('join');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * In a room, Back must not silently drop you out of the game (or off the
   * site). Entering a room pushes a guard entry; Back pops it, and we ask. Stay
   * and the guard goes back; leave and it's the same as "leave to home".
   */
  const viewRef = useRef(view);
  viewRef.current = view;
  const guardedRoom = useRef<string | null>(null);
  useEffect(() => {
    const code = view?.code ?? null;
    if (code && guardedRoom.current !== code) {
      window.history.pushState({ moji: 'room' }, '', `/r/${code}`);
      guardedRoom.current = code;
    }
    if (!code) guardedRoom.current = null;
  }, [view?.code]);
  useEffect(() => {
    const onPop = () => {
      const current = viewRef.current;
      if (current?.code) {
        if (window.confirm('Leave this game? Your seat and points will be given up.')) {
          guardedRoom.current = null;
          void game.leave();
          setRouteState('landing');
          window.history.replaceState(null, '', '/');
        } else {
          window.history.pushState({ moji: 'room' }, '', `/r/${current.code}`);
        }
        return;
      }
      setRouteState('landing');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the browser URL in sync: /r/<CODE> while in a room, / on the landing.
  useEffect(() => {
    const path = view?.code ? `/r/${view.code}` : route === 'landing' ? '/' : null;
    if (path && window.location.pathname !== path) {
      window.history.replaceState(null, '', path);
    }
  }, [view?.code, route]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 5000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(clearNotice, 9000);
    return () => clearTimeout(id);
  }, [notice, clearNotice]);

  // The room vanished while we were disconnected (useGame has already said so in
  // the banner): go home rather than back to whichever pre-game form we came from.
  useEffect(() => {
    if (roomLost) setRoute('landing');
  }, [roomLost]);

  // Nothing on the very first connect, which is normally instant; a bar only
  // when we lost a connection we had, or can't get one at all.
  const connectionNotice = connected
    ? null
    : hasConnected
      ? 'Reconnecting…'
      : unreachable
        ? "Can't reach Moji right now. Retrying…"
        : null;

  return (
    <div className="min-h-screen">
      {connectionNotice && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-20 bg-orange py-1 text-center font-mono text-xs uppercase tracking-[2px] text-outline"
        >
          {connectionNotice}
        </div>
      )}
      {notice && !error && (
        <div
          role="status"
          onClick={clearNotice}
          className="fixed inset-x-0 top-0 z-30 cursor-pointer bg-cyan px-4 py-2 text-center text-sm font-semibold text-outline"
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          onClick={clearError}
          className="fixed inset-x-0 top-0 z-30 cursor-pointer bg-coral px-4 py-2 text-center text-sm font-semibold text-outline"
        >
          {error}
        </div>
      )}
      {render()}
    </div>
  );

  function render() {
    if (game.replaced && view) return <OpenElsewhere onPlayHere={() => void game.takeBack()} />;
    if (!view || view.phase === 'ROOM_CLOSED') {
      if (route === 'landing') {
        return (
          <Landing
            onCreate={() => setRoute('create')}
            onJoin={() => setRoute('join')}
            onSolo={startSolo}
          />
        );
      }
      if (route === 'solo') return <DealingSolo />;
      return (
        <Join
          mode={route === 'create' ? 'create' : 'join'}
          initialCode={prefillCode}
          game={game}
          onBack={() => setRoute('landing')}
        />
      );
    }

    switch (view.phase) {
      case 'LOBBY':
        return <LobbyScreen game={game} view={view} />;
      case 'ROUND_INTRO':
        return <RoundIntro view={view} />;
      case 'PROMPT_ASSIGNMENT':
        // A player who joined mid-round has no prompt yet — they're dealt in next round.
        return view.yourPrompt ? <PromptAssignment view={view} /> : <JoiningNextRound />;
      case 'CLUE_CREATION':
        return view.yourPrompt ? <ClueScreen game={game} view={view} /> : <JoiningNextRound />;
      case 'CLUE_REVEAL':
      case 'GUESSING':
        return <GuessScreen game={game} view={view} />;
      case 'CLUE_SCORING':
        return <RevealScreen game={game} view={view} />;
      case 'ROUND_RESULTS':
        return <Leaderboard game={game} view={view} />;
      case 'GAME_RESULTS':
        return (
          <Winner
            game={game}
            view={view}
            onLeave={() => {
              void game.leave();
              setRoute('landing');
            }}
          />
        );
      default:
        return <SplashScreen view={view} />;
    }
  }
}
