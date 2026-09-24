import { supabase } from "@/integrations/supabase/client";

// The online tables and functions are guest-scoped (no signed-in user), so we
// call them through a loosely typed handle instead of the generated types.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

export type MatchInfo = {
  matchId: string;
  myColor: "w" | "b";
  opponentName: string;
};

export type MovePayload = {
  from: { r: number; c: number };
  to: { r: number; c: number };
  promotion: string | null;
};

export type ChatMessage = {
  id: number;
  sender: string;
  sender_name: string;
  body: string;
  created_at: string;
};

export async function joinMatch(guestId: string, name: string): Promise<string | null> {
  const { data, error } = await db.rpc("join_match", { p_guest: guestId, p_name: name });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function getCurrentMatch(guestId: string): Promise<MatchInfo | null> {
  const { data, error } = await db.rpc("current_match", { p_guest: guestId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    matchId: row.match_id as string,
    myColor: row.my_color === "b" ? "b" : "w",
    opponentName: (row.opponent_name as string) || "Guest",
  };
}

export async function leaveMatch(guestId: string): Promise<void> {
  const { error } = await db.rpc("leave_match", { p_guest: guestId });
  if (error) throw error;
}

export async function submitMove(
  matchId: string,
  guestId: string,
  move: MovePayload,
): Promise<void> {
  const { error } = await db.rpc("submit_move", {
    p_match: matchId,
    p_guest: guestId,
    p_from_r: move.from.r,
    p_from_c: move.from.c,
    p_to_r: move.to.r,
    p_to_c: move.to.c,
    p_promotion: move.promotion,
  });
  if (error) throw error;
}

export type MoveRow = {
  ply: number;
  mover: string;
  from_r: number;
  from_c: number;
  to_r: number;
  to_c: number;
  promotion: string | null;
};

export async function fetchMoves(matchId: string): Promise<MoveRow[]> {
  const { data, error } = await db
    .from("moves")
    .select("ply, mover, from_r, from_c, to_r, to_c, promotion")
    .eq("match_id", matchId)
    .order("ply", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MoveRow[];
}

export async function sendChat(matchId: string, guestId: string, body: string): Promise<void> {
  const { error } = await db.rpc("send_chat", {
    p_match: matchId,
    p_guest: guestId,
    p_body: body,
  });
  if (error) throw error;
}

export async function fetchChat(matchId: string): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from("chat_messages")
    .select("id, sender, sender_name, body, created_at")
    .eq("match_id", matchId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export function moveToPayload(row: MoveRow): MovePayload {
  return {
    from: { r: row.from_r, c: row.from_c },
    to: { r: row.to_r, c: row.to_c },
    promotion: row.promotion,
  };
}

export function subscribeToMoves(matchId: string, onMove: (row: MoveRow) => void) {
  return supabase
    .channel(`moves-${matchId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "moves", filter: `match_id=eq.${matchId}` },
      (payload) => onMove(payload.new as unknown as MoveRow),
    )
    .subscribe();
}

export function subscribeToChat(matchId: string, onMessage: (row: ChatMessage) => void) {
  return supabase
    .channel(`chat-${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => onMessage(payload.new as unknown as ChatMessage),
    )
    .subscribe();
}

export function subscribeToMatch(matchId: string, onEnded: () => void) {
  return supabase
    .channel(`match-${matchId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
      (payload) => {
        if ((payload.new as { status?: string }).status !== "active") onEnded();
      },
    )
    .subscribe();
}
