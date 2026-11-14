import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ConfigureRoomPayload,
  GuessResult,
  JoinRoomResult,
  PublicGuess,
  RoomView,
} from '@moji/shared';
import { NO_ANSWER, emitAck, socket } from './socket.js';
import {
  clearToken,
  getStoredAvatar,
  getStoredName,
  getToken,
  saveSession,
  tokenRoomCode,
} from './session.js';

export const GAME_ENDED = 'That game has ended. The room closed while you were away.';

export interface GameClient {
  connected: boolean;
  /** Has this page ever reached the server? Tells "connecting" apart from "reconnecting". */
  hasConnected: boolean;
  /** The server can't be reached right now (a connect attempt failed). */
  unreachable: boolean;
  /** Bumps each time the room we were in turns out to be gone after a reconnect. */
  roomLost: number;
  view: RoomView | null;
  feed: PublicGuess[];
  /** The solvers' side channel for the active clue; empty until we can see it. */
  chat: ChatMessage[];
  /** Letter blanks for the active clue, filling in during GUESSING. */
  hint: string | null;
  error: string | null;
  myId: string | null;
  join(displayName: string, avatar: string, code?: string): Promise<JoinRoomResult>;
  /** Start a solo game against the bot: a fresh room, already under way. */
  joinSolo(displayName: string, avatar: string): Promise<JoinRoomResult>;
  configure(payload: ConfigureRoomPayload): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  start(): Promise<void>;
  reshuffle(): Promise<void>;
  leave(): Promise<void>;
  submitClue(emojis: string[]): Promise<void>;
  submitGuess(text: string): Promise<GuessResult>;
  bump(): Promise<void>;
  sendChat(text: string): Promise<void>;
  skip(): Promise<void>;
  next(): Promise<void>;
  clearError(): void;
}

/** Union of the live guess stream and the snapshot's, oldest first, deduped by id. */
function mergeFeed(local: PublicGuess[], snapshot: PublicGuess[]): PublicGuess[] {
  const byId = new Map(snapshot.map((g) => [g.id, g]));
  for (const g of local) if (!byId.has(g.id)) byId.set(g.id, g);
  return [...byId.values()]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(-100);
}

export function useGame(): GameClient {
  const [connected, setConnected] = useState(socket.connected);
  const [view, setView] = useState<RoomView | null>(null);
  const [feed, setFeed] = useState<PublicGuess[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [hasConnected, setHasConnected] = useState(socket.connected);
  const [unreachable, setUnreachable] = useState(false);
  const [roomLost, setRoomLost] = useState(0);
  const activeAuthorRef = useRef<string | null>(null);
  /** The room code we're in, readable from socket callbacks without re-subscribing. */
  const roomCodeRef = useRef<string | null>(null);
  const everConnectedRef = useRef(socket.connected);

  /** Show a command's failure in the app banner. The promise still rejects for callers that await it. */
  const surfaced = useCallback(<T,>(p: Promise<T>): Promise<T> => {
    p.catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong.'));
    return p;
  }, []);

  useEffect(() => {
    /**
     * Back after a drop. The server binds players to sockets, and this is a new
     * socket, so until we rejoin it sends us nothing and refuses our commands.
     * Rejoin our seat with the session token. If the room is gone (the server
     * restarted, or everyone left), say so and go home instead of freezing on
     * the last screen.
     */
    const rejoin = () => {
      const code = roomCodeRef.current;
      if (!code || tokenRoomCode() !== code) return;
      emitAck<JoinRoomResult>('room:join', {
        code,
        sessionToken: getToken(),
        displayName: getStoredName() || 'Player',
        avatar: getStoredAvatar(),
      })
        .then((res) => {
          saveSession(res.sessionToken, getStoredName() || 'Player', getStoredAvatar());
          setMyId(res.playerId);
        })
        .catch((err: unknown) => {
          // No answer isn't "the room is gone": keep the screen and say so. The
          // next reconnect tries again.
          if (err instanceof Error && err.message === NO_ANSWER) {
            setError(NO_ANSWER);
            return;
          }
          clearToken();
          roomCodeRef.current = null;
          activeAuthorRef.current = null;
          setMyId(null);
          setView(null);
          setFeed([]);
          setChat([]);
          setHint(null);
          setError(GAME_ENDED);
          setRoomLost((n) => n + 1);
        });
    };
    const onConnect = () => {
      setConnected(true);
      setHasConnected(true);
      setUnreachable(false);
      if (everConnectedRef.current) rejoin();
      everConnectedRef.current = true;
    };
    const onConnectError = () => setUnreachable(true);
    const onDisconnect = () => setConnected(false);
    const onState = (next: RoomView) => {
      // Reset the live feed when a new clue starts.
      const author = next.activeClue?.authorId ?? null;
      if (author !== activeAuthorRef.current) {
        activeAuthorRef.current = author;
        // Seed from the snapshot rather than emptying: `guess:new` only reaches
        // clients that were connected when it fired, so a player who joined,
        // reloaded, or reconnected mid-clue would otherwise stare at an empty
        // feed until somebody guessed again. The server scopes guessFeed to the
        // current clue, so this can't drag in the previous one's guesses.
        setFeed(next.guessFeed);
        setChat(next.clueChat);
        setHint(next.activeClue?.hint ?? null);
      } else {
        // Same clue: union the snapshot with what the live stream gave us.
        // Neither is a superset — the snapshot can be a tick behind the events,
        // and the events miss anything from before we connected.
        setFeed((cur) => mergeFeed(cur, next.guessFeed));
        // The snapshot is authoritative for chat: it is empty until we're
        // entitled to it, then arrives whole (on solving, or on the reveal).
        setChat(next.clueChat);
        // Same clue: keep what the tick stream gave us, but pick up the mask
        // from the snapshot when we don't have one yet (guessing just opened,
        // or we reconnected mid-clue).
        setHint((cur) => cur ?? next.activeClue?.hint ?? null);
      }
      roomCodeRef.current = next.code;
      setView(next);
    };
    const onGuess = (g: PublicGuess) => setFeed((f) => [...f, g].slice(-100));
    const onChat = (m: ChatMessage) =>
      setChat((c) => (c.some((x) => x.id === m.id) ? c : [...c, m].slice(-100)));
    const onHint = (h: string) => setHint(h);

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('guess:new', onGuess);
    socket.on('clue:hint', onHint);
    socket.on('chat:new', onChat);
    return () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('guess:new', onGuess);
      socket.off('clue:hint', onHint);
      socket.off('chat:new', onChat);
    };
  }, []);

  const join = useCallback<GameClient['join']>(async (displayName, avatar, code) => {
    const res = await surfaced(
      emitAck<JoinRoomResult>('room:join', {
        displayName,
        avatar,
        code,
        sessionToken: getToken(),
      }),
    );
    saveSession(res.sessionToken, displayName, avatar);
    setMyId(res.playerId);
    return res;
  }, [surfaced]);

  const joinSolo = useCallback<GameClient['joinSolo']>(async (displayName, avatar) => {
    // No sessionToken: solo always means a new room. Passing the old token
    // would let the reconnect path drop us back into a finished game.
    const res = await surfaced(
      emitAck<JoinRoomResult>('room:join', { displayName, avatar, solo: true }),
    );
    saveSession(res.sessionToken, displayName, avatar);
    setMyId(res.playerId);
    return res;
  }, [surfaced]);

  const configure = useCallback<GameClient['configure']>(
    (payload) => surfaced(emitAck('room:configure', payload)),
    [surfaced],
  );
  const setReady = useCallback<GameClient['setReady']>(
    (ready) => surfaced(emitAck('player:ready', ready)),
    [surfaced],
  );
  const start = useCallback<GameClient['start']>(() => surfaced(emitAck('game:start')), [surfaced]);
  const reshuffle = useCallback<GameClient['reshuffle']>(
    () => surfaced(emitAck('clue:reshuffle')),
    [surfaced],
  );
  const leave = useCallback<GameClient['leave']>(async () => {
    try {
      await emitAck('room:leave');
    } catch {
      /* leaving best-effort */
    }
    clearToken();
    roomCodeRef.current = null;
    setMyId(null);
    setFeed([]);
    setChat([]);
    setView(null);
  }, []);
  const submitClue = useCallback<GameClient['submitClue']>(
    (emojis) => surfaced(emitAck('clue:submit', { emojis })),
    [surfaced],
  );
  // A rejected guess comes back as a result with a `reason`, not an error; the
  // Guess screen shows that inline. Only transport/server failures reach the banner.
  const submitGuess = useCallback<GameClient['submitGuess']>(
    (text) => surfaced(emitAck<GuessResult>('guess:submit', { text })),
    [surfaced],
  );
  const bump = useCallback<GameClient['bump']>(() => surfaced(emitAck('clue:bump')), [surfaced]);
  const sendChat = useCallback<GameClient['sendChat']>(
    (text) => surfaced(emitAck('clue:chat', { text })),
    [surfaced],
  );
  const skip = useCallback<GameClient['skip']>(() => surfaced(emitAck('host:skip')), [surfaced]);
  const next = useCallback<GameClient['next']>(() => surfaced(emitAck('host:next')), [surfaced]);
  const clearError = useCallback(() => setError(null), []);

  return {
    connected,
    hasConnected,
    unreachable,
    roomLost,
    view,
    feed,
    chat,
    hint,
    error,
    myId,
    join,
    joinSolo,
    configure,
    setReady,
    start,
    reshuffle,
    leave,
    submitClue,
    submitGuess,
    bump,
    sendChat,
    skip,
    next,
    clearError,
  };
}
