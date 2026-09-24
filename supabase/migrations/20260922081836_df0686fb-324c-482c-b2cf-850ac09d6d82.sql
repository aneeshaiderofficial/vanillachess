CREATE TABLE public.guests (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.guests TO anon, authenticated;
GRANT ALL ON public.guests TO service_role;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guests readable" ON public.guests FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "guests insertable" ON public.guests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "guests updatable" ON public.guests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.match_queue (
  guest_id uuid PRIMARY KEY REFERENCES public.guests(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_queue TO anon, authenticated;
GRANT ALL ON public.match_queue TO service_role;
ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "queue readable" ON public.match_queue FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "queue writable" ON public.match_queue FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  white_guest uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  black_guest uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX matches_white_idx ON public.matches (white_guest, status);
CREATE INDEX matches_black_idx ON public.matches (black_guest, status);
GRANT SELECT, INSERT, UPDATE ON public.matches TO anon, authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matches readable" ON public.matches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "matches insertable" ON public.matches FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "matches updatable" ON public.matches FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.moves (
  id bigserial PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  ply integer NOT NULL,
  mover uuid NOT NULL,
  from_r smallint NOT NULL,
  from_c smallint NOT NULL,
  to_r smallint NOT NULL,
  to_c smallint NOT NULL,
  promotion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, ply)
);
GRANT SELECT, INSERT ON public.moves TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.moves_id_seq TO anon, authenticated;
GRANT ALL ON public.moves TO service_role;
GRANT ALL ON SEQUENCE public.moves_id_seq TO service_role;
ALTER TABLE public.moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moves readable" ON public.moves FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "moves insertable" ON public.moves FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE public.chat_messages (
  id bigserial PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  sender uuid NOT NULL,
  sender_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_match_idx ON public.chat_messages (match_id, id);
GRANT SELECT, INSERT ON public.chat_messages TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.chat_messages_id_seq TO anon, authenticated;
GRANT ALL ON public.chat_messages TO service_role;
GRANT ALL ON SEQUENCE public.chat_messages_id_seq TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat readable" ON public.chat_messages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "chat insertable" ON public.chat_messages FOR INSERT TO anon, authenticated WITH CHECK (length(btrim(body)) > 0 AND length(body) <= 500);

ALTER TABLE public.moves REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.matches REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.moves;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;

CREATE OR REPLACE FUNCTION public.join_match(p_guest uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opponent uuid;
  v_match uuid;
BEGIN
  IF p_guest IS NULL OR btrim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'guest id and name are required';
  END IF;

  INSERT INTO guests (id, name) VALUES (p_guest, left(btrim(p_name), 24))
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, last_seen = now();

  SELECT id INTO v_match FROM matches
  WHERE status = 'active' AND (white_guest = p_guest OR black_guest = p_guest)
  ORDER BY created_at DESC LIMIT 1;
  IF v_match IS NOT NULL THEN
    RETURN v_match;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('vanilla_chess_queue'));

  DELETE FROM match_queue WHERE created_at < now() - interval '3 minutes';

  SELECT guest_id INTO v_opponent FROM match_queue
  WHERE guest_id <> p_guest ORDER BY created_at LIMIT 1;

  IF v_opponent IS NOT NULL THEN
    DELETE FROM match_queue WHERE guest_id IN (v_opponent, p_guest);
    INSERT INTO matches (white_guest, black_guest) VALUES (v_opponent, p_guest)
    RETURNING id INTO v_match;
    RETURN v_match;
  END IF;

  INSERT INTO match_queue (guest_id, name) VALUES (p_guest, left(btrim(p_name), 24))
  ON CONFLICT (guest_id) DO UPDATE SET created_at = now(), name = excluded.name;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.join_match(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_match(uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_match(p_guest uuid)
RETURNS TABLE (match_id uuid, my_color text, opponent_name text, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id,
         CASE WHEN m.white_guest = p_guest THEN 'w' ELSE 'b' END,
         CASE WHEN m.white_guest = p_guest THEN gb.name ELSE gw.name END,
         m.status
  FROM matches m
  JOIN guests gw ON gw.id = m.white_guest
  JOIN guests gb ON gb.id = m.black_guest
  WHERE m.status = 'active' AND (m.white_guest = p_guest OR m.black_guest = p_guest)
  ORDER BY m.created_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_match(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_move(
  p_match uuid, p_guest uuid,
  p_from_r integer, p_from_c integer, p_to_r integer, p_to_c integer,
  p_promotion text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ply integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM matches
    WHERE id = p_match AND status = 'active'
      AND (white_guest = p_guest OR black_guest = p_guest)
  ) THEN
    RAISE EXCEPTION 'not a player in this match';
  END IF;

  SELECT coalesce(max(ply), -1) + 1 INTO v_ply FROM moves WHERE match_id = p_match;

  INSERT INTO moves (match_id, ply, mover, from_r, from_c, to_r, to_c, promotion)
  VALUES (p_match, v_ply, p_guest, p_from_r, p_from_c, p_to_r, p_to_c, p_promotion);

  RETURN v_ply;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_move(uuid, uuid, integer, integer, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_move(uuid, uuid, integer, integer, integer, integer, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.leave_match(p_guest uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM match_queue WHERE guest_id = p_guest;
  UPDATE matches SET status = 'ended', ended_at = now()
  WHERE status = 'active' AND (white_guest = p_guest OR black_guest = p_guest);
  DELETE FROM chat_messages c
  USING matches m
  WHERE c.match_id = m.id AND m.status = 'ended'
    AND (m.white_guest = p_guest OR m.black_guest = p_guest);
END;
$$;
REVOKE ALL ON FUNCTION public.leave_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_match(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_chat(p_match uuid, p_guest uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM matches
    WHERE id = p_match AND status = 'active'
      AND (white_guest = p_guest OR black_guest = p_guest)
  ) THEN
    RAISE EXCEPTION 'not a player in this match';
  END IF;
  IF btrim(coalesce(p_body, '')) = '' THEN
    RETURN;
  END IF;
  SELECT name INTO v_name FROM guests WHERE id = p_guest;
  INSERT INTO chat_messages (match_id, sender, sender_name, body)
  VALUES (p_match, p_guest, coalesce(v_name, 'Guest'), left(btrim(p_body), 500));
END;
$$;
REVOKE ALL ON FUNCTION public.send_chat(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_chat(uuid, uuid, text) TO anon, authenticated, service_role;