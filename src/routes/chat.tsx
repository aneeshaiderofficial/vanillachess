import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { GuestSignIn } from "@/components/GuestSignIn";
import { loadGuest, type Guest } from "@/lib/guest";
import {
  fetchChat,
  getCurrentMatch,
  sendChat,
  subscribeToChat,
  type ChatMessage,
  type MatchInfo,
} from "@/lib/online";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Match chat — Vanilla Chess by Anees Haider" },
      {
        name: "description",
        content: "Chat with your opponent during an online game of Vanilla Chess by Anees Haider.",
      },
      { property: "og:title", content: "Match chat — Vanilla Chess" },
      {
        property: "og:description",
        content: "Talk to the player you were matched with while your game is running.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const [ready, setReady] = useState(false);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setGuest(loadGuest());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!guest) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await getCurrentMatch(guest.id);
        if (cancelled) return;
        setMatch(info);
        if (info) setMessages(await fetchChat(info.matchId));
      } catch (caught) {
        console.error(caught);
        if (!cancelled) setError("Couldn't load the conversation.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guest]);

  useEffect(() => {
    if (!match) return;
    const channel = subscribeToChat(match.matchId, (message) => {
      setMessages((current) =>
        current.some((item) => item.id === message.id) ? current : [...current, message],
      );
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [match]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (!ready) return <main className="min-h-dvh bg-background" />;
  if (!guest) return <GuestSignIn onDone={setGuest} />;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background px-4 py-4">
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="font-serif text-xl font-bold text-foreground">
            {match ? `Chat with ${match.opponentName}` : "Match chat"}
          </h1>
          <p className="text-xs text-muted-foreground">You are {guest.name}</p>
        </div>
        <Link
          to="/"
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
        >
          Back to board
        </Link>
      </header>

      {!match && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          You're not in an online game right now. Start one from the board, then come back here to
          chat.
        </p>
      )}

      {match && (
        <>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-4">
            {messages.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                No messages yet — say hello.
              </p>
            )}
            {messages.map((message) => {
              const mine = message.sender === guest.id;
              return (
                <div key={message.id} className={mine ? "text-right" : "text-left"}>
                  <span
                    className={`inline-block max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card text-card-foreground"
                    }`}
                  >
                    {!mine && (
                      <span className="mb-0.5 block text-[0.65rem] uppercase tracking-wide opacity-70">
                        {message.sender_name}
                      </span>
                    )}
                    {message.body}
                  </span>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const body = draft.trim();
              if (!body) return;
              setDraft("");
              try {
                await sendChat(match.matchId, guest.id, body);
              } catch (caught) {
                console.error(caught);
                setError("Message didn't send.");
              }
            }}
            className="flex gap-2 border-t border-border pt-3"
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={500}
              placeholder="Write a message"
              aria-label="Message"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Send
            </button>
          </form>
        </>
      )}

      {error && <p className="pt-2 text-center text-xs text-destructive">{error}</p>}
    </main>
  );
}
