import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { GuestSignIn } from "@/components/GuestSignIn";
import { clearGuestName, loadGuest, type Guest } from "@/lib/guest";
import {
  fetchMoves,
  getCurrentMatch,
  joinMatch,
  leaveMatch,
  moveToPayload,
  submitMove,
  subscribeToChat,
  subscribeToMatch,
  subscribeToMoves,
  type MatchInfo,
  type MovePayload,
  type MoveRow,
} from "@/lib/online";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vanilla Chess by Anees Haider" },
      {
        name: "description",
        content:
          "Play Vanilla Chess by Anees Haider — join as a guest, get matched with another player online, and chat while you play.",
      },
      { property: "og:title", content: "Vanilla Chess by Anees Haider" },
      {
        property: "og:description",
        content: "Play a timeless game online against another guest, and chat while you play.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type OnlineState = "off" | "searching" | "playing";

function Index() {
  const [ready, setReady] = useState(false);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [onlineState, setOnlineState] = useState<OnlineState>("off");
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameReadyRef = useRef(false);
  const lastPlyRef = useRef(-1);
  const matchRef = useRef<MatchInfo | null>(null);
  const guestRef = useRef<Guest | null>(null);

  useEffect(() => {
    setGuest(loadGuest());
    setReady(true);
  }, []);

  useEffect(() => {
    guestRef.current = guest;
  }, [guest]);
  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  const post = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(message, "*");
  }, []);

  const applyMoveRow = useCallback(
    (row: MoveRow) => {
      if (row.ply <= lastPlyRef.current) return;
      lastPlyRef.current = row.ply;
      if (row.mover === guestRef.current?.id) return;
      post({ type: "vc:remote-move", move: moveToPayload(row) });
    },
    [post],
  );

  const startMatch = useCallback(
    async (info: MatchInfo) => {
      setMatch(info);
      matchRef.current = info;
      setOnlineState("playing");
      setNotice(null);
      setUnread(0);
      lastPlyRef.current = -1;
      post({ type: "vc:online-start", color: info.myColor });
      const rows = await fetchMoves(info.matchId);
      for (const row of rows) applyMoveRow(row);
    },
    [applyMoveRow, post],
  );

  const endOnline = useCallback(
    async (message: string | null, tellServer: boolean) => {
      const currentGuest = guestRef.current;
      setOnlineState("off");
      setMatch(null);
      matchRef.current = null;
      setUnread(0);
      lastPlyRef.current = -1;
      post({ type: "vc:online-end" });
      if (tellServer && currentGuest) {
        try {
          await leaveMatch(currentGuest.id);
        } catch (error) {
          console.error(error);
        }
      }
      setNotice(message);
    },
    [post],
  );

  const search = useCallback(async () => {
    const currentGuest = guestRef.current;
    if (!currentGuest) return;
    setNotice(null);
    setOnlineState("searching");
    try {
      const matchId = await joinMatch(currentGuest.id, currentGuest.name);
      if (matchId) {
        const info = await getCurrentMatch(currentGuest.id);
        if (info) await startMatch(info);
      }
    } catch (error) {
      console.error(error);
      setOnlineState("off");
      setNotice("Couldn't reach the matchmaking service. Playing on this device instead.");
    }
  }, [startMatch]);

  // Rejoin an ongoing match after a refresh.
  useEffect(() => {
    if (!guest || onlineState !== "off" || matchRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await getCurrentMatch(guest.id);
        if (!cancelled && info) await startMatch(info);
      } catch (error) {
        console.error(error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest]);

  // Poll while waiting for an opponent. Re-calling joinMatch also keeps our
  // queue row fresh, so players who closed the tab get dropped automatically.
  useEffect(() => {
    if (onlineState !== "searching" || !guest) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        await joinMatch(guest.id, guest.name);
        const info = await getCurrentMatch(guest.id);
        if (!cancelled && info) await startMatch(info);
      } catch (error) {
        console.error(error);
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [onlineState, guest, startMatch]);

  // Messages from the game board.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; mode?: string; move?: MovePayload } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "vc:ready") {
        frameReadyRef.current = true;
        const info = matchRef.current;
        if (info) post({ type: "vc:online-start", color: info.myColor });
        return;
      }
      if (data.type === "vc:mode") {
        if (data.mode === "human") void search();
        else void endOnline(null, true);
        return;
      }
      if (data.type === "vc:move" && data.move) {
        const info = matchRef.current;
        const currentGuest = guestRef.current;
        if (!info || !currentGuest) return;
        submitMove(info.matchId, currentGuest.id, data.move).catch((error) => {
          console.error(error);
          setNotice("That move didn't reach your opponent. Check your connection.");
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [post, search, endOnline]);

  // Live moves, chat badge and match end.
  useEffect(() => {
    if (!match) return;
    const moveChannel = subscribeToMoves(match.matchId, applyMoveRow);
    const chatChannel = subscribeToChat(match.matchId, (message) => {
      if (message.sender !== guestRef.current?.id) setUnread((count) => count + 1);
    });
    const matchChannel = subscribeToMatch(match.matchId, () => {
      void endOnline(`${match.opponentName} left the game. You're back to local play.`, false);
    });
    return () => {
      supabase.removeChannel(moveChannel);
      supabase.removeChannel(chatChannel);
      supabase.removeChannel(matchChannel);
    };
  }, [match, applyMoveRow, endOnline]);

  if (!ready) return <main className="min-h-dvh bg-background" />;
  if (!guest) return <GuestSignIn onDone={setGuest} />;

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b border-border px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          Playing as <span className="font-semibold text-foreground">{guest.name}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            void endOnline(null, true);
            clearGuestName();
            setGuest(null);
          }}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Not you?
        </button>

        {onlineState === "off" && (
          <button
            type="button"
            onClick={() => void search()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Play online
          </button>
        )}

        {onlineState === "searching" && (
          <>
            <span className="animate-pulse font-medium text-foreground">
              Looking for an opponent…
            </span>
            <button
              type="button"
              onClick={() => void endOnline("Search cancelled.", true)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </>
        )}

        {onlineState === "playing" && match && (
          <>
            <span className="font-medium text-foreground">
              Matched with {match.opponentName} — you play{" "}
              {match.myColor === "w" ? "White" : "Black"}
            </span>
            <Link
              to="/chat"
              className="relative rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
            >
              Chat
              {unread > 0 && (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[0.65rem] text-primary-foreground">
                  {unread}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => void endOnline("You left the online game.", true)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
            >
              Leave game
            </button>
          </>
        )}
      </div>

      {notice && (
        <p className="border-b border-border px-3 py-2 text-center text-xs text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <iframe
          ref={frameRef}
          className="h-full min-h-[640px] w-full border-0"
          src="/vanilla-chess.html"
          title="Vanilla Chess by Anees Haider"
        />
      </div>
    </main>
  );
}
