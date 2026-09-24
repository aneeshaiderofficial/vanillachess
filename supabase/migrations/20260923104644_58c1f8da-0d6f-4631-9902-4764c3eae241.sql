CREATE OR REPLACE FUNCTION public.join_match(p_guest uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- clients refresh their queue row every 2 seconds while searching
  DELETE FROM match_queue WHERE created_at < now() - interval '20 seconds';

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
$function$;

DELETE FROM public.match_queue;