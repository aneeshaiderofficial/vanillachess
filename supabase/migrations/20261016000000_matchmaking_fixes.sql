-- Matchmaking fixes: expire dead games, add heartbeats, and close direct writes.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS white_seen timestamptz,
  ADD COLUMN IF NOT EXISTS black_seen timestamptz;

CREATE OR REPLACE FUNCTION public.end_stale_matches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE matches SET status = 'ended', ended_at = now()
  WHERE status = 'active'
    AND (
      coalesce(white_seen, created_at) < now() - interval '45 seconds'
      OR coalesce(black_seen, created_at) < now() - interval '45 seconds'
    );
END;
$$;
REVOKE ALL ON FUNCTION public.end_stale_matches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_stale_matches() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_match(p_match uuid, p_guest uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM matches
    WHERE id = p_match AND status = 'active'
      AND (white_guest = p_guest OR black_guest = p_guest)
  ) THEN
    RAISE EXCEPTION 'not a player in this match';
  END IF;

  UPDATE matches
  SET white_seen = CASE WHEN white_guest = p_guest THEN now() ELSE white_seen END,
      black_seen = CASE WHEN black_guest = p_guest THEN now() ELSE black_seen END
  WHERE id = p_match AND status = 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.heartbeat_match(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_match(uuid, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.end_match(p_match uuid, p_guest uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM matches
    WHERE id = p_match
      AND (white_guest = p_guest OR black_guest = p_guest)
  ) THEN
    RAISE EXCEPTION 'not a player in this match';
  END IF;

  UPDATE matches SET status = 'ended', ended_at = now()
  WHERE id = p_match AND status = 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.end_match(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_match(uuid, uuid) TO anon, authenticated, service_role;

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
  PERFORM end_stale_matches();

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

  -- clients refresh their queue row every 2 seconds while searching
  DELETE FROM match_queue WHERE created_at < now() - interval '20 seconds';

  SELECT guest_id INTO v_opponent FROM match_queue
  WHERE guest_id <> p_guest ORDER BY created_at LIMIT 1;

  IF v_opponent IS NOT NULL THEN
    DELETE FROM match_queue WHERE guest_id IN (v_opponent, p_guest);
    INSERT INTO matches (white_guest, black_guest, white_seen, black_seen)
    VALUES (v_opponent, p_guest, now(), now())
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

  PERFORM pg_advisory_xact_lock(hashtext(p_match::text));

  SELECT coalesce(max(ply), -1) + 1 INTO v_ply FROM moves WHERE match_id = p_match;

  INSERT INTO moves (match_id, ply, mover, from_r, from_c, to_r, to_c, promotion)
  VALUES (p_match, v_ply, p_guest, p_from_r, p_from_c, p_to_r, p_to_c, p_promotion);

  RETURN v_ply;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_move(uuid, uuid, integer, integer, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_move(uuid, uuid, integer, integer, integer, integer, text) TO anon, authenticated, service_role;

-- All writes now go through the SECURITY DEFINER functions above. SELECT
-- policies stay so Realtime subscriptions keep working.
DROP POLICY IF EXISTS "matches insertable" ON public.matches;
DROP POLICY IF EXISTS "matches updatable" ON public.matches;
DROP POLICY IF EXISTS "moves insertable" ON public.moves;
DROP POLICY IF EXISTS "queue writable" ON public.match_queue;
DROP POLICY IF EXISTS "guests insertable" ON public.guests;
DROP POLICY IF EXISTS "guests updatable" ON public.guests;
