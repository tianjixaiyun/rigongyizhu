-- PostgreSQL/PostgREST 迁移。先在 WorkBuddy 核实 JWT claims 与 authenticated 角色。
-- 仅新增专用表和函数；不修改/删除原 snapshots、media_files、房间表或用户。
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'WorkBuddy authenticated role must be verified before installing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rigong_sync_uid() RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE claims jsonb; result text;
BEGIN
  claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  result := NULLIF(claims->>'sub', '');
  IF result IS NULL OR COALESCE(claims->>'is_anonymous', 'false') = 'true'
    OR COALESCE(claims->>'scope', '') = 'anonymous' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  RETURN result;
END $$;

CREATE TABLE IF NOT EXISTS public.rigong_sync_heads (
  owner_id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  payload jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rigong_sync_history (
  owner_id text NOT NULL,
  revision bigint NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, revision)
);
ALTER TABLE public.rigong_sync_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rigong_sync_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rigong_sync_heads' AND policyname='rigong_owner_read') THEN
    CREATE POLICY rigong_owner_read ON public.rigong_sync_heads FOR SELECT TO authenticated
      USING (owner_id = (SELECT public.rigong_sync_uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rigong_sync_history' AND policyname='rigong_owner_read') THEN
    CREATE POLICY rigong_owner_read ON public.rigong_sync_history FOR SELECT TO authenticated
      USING (owner_id = (SELECT public.rigong_sync_uid()));
  END IF;
END $$;
REVOKE ALL ON public.rigong_sync_heads, public.rigong_sync_history FROM PUBLIC, authenticated;
GRANT SELECT ON public.rigong_sync_heads, public.rigong_sync_history TO authenticated;

CREATE OR REPLACE FUNCTION public.rigong_sync_pull() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller text := public.rigong_sync_uid(); result jsonb;
BEGIN
  SELECT jsonb_build_object('owner_id', owner_id, 'revision', revision, 'payload', payload, 'updated_at', updated_at)
    INTO result FROM public.rigong_sync_heads WHERE owner_id = caller;
  RETURN COALESCE(result, jsonb_build_object('owner_id', caller, 'revision', 0, 'payload', NULL));
END $$;

CREATE OR REPLACE FUNCTION public.rigong_sync_push(p_revision bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller text := public.rigong_sync_uid(); head public.rigong_sync_heads%ROWTYPE;
BEGIN
  IF p_revision IS NULL OR p_revision < 0 OR p_payload IS NULL
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload->'logs') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'settings') IS DISTINCT FROM 'object'
    OR p_payload #>> '{_sync,version}' IS DISTINCT FROM '1'
    OR octet_length(p_payload::text) > 10485760 THEN
    RAISE EXCEPTION 'invalid sync payload or payload exceeds 10 MiB' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rigong_sync_heads(owner_id) VALUES (caller) ON CONFLICT DO NOTHING;
  SELECT * INTO head FROM public.rigong_sync_heads WHERE owner_id = caller FOR UPDATE;
  IF head.revision <> p_revision THEN
    RETURN jsonb_build_object('owner_id', caller, 'revision', head.revision, 'payload', head.payload,
      'updated_at', head.updated_at, 'conflict', true);
  END IF;
  IF head.payload IS NOT DISTINCT FROM p_payload THEN
    RETURN jsonb_build_object('owner_id', caller, 'revision', head.revision, 'payload', head.payload,
      'updated_at', head.updated_at, 'conflict', false);
  END IF;
  UPDATE public.rigong_sync_heads SET payload = p_payload, revision = revision + 1, updated_at = clock_timestamp()
    WHERE owner_id = caller RETURNING * INTO head;
  INSERT INTO public.rigong_sync_history(owner_id, revision, payload) VALUES (caller, head.revision, head.payload);
  RETURN jsonb_build_object('owner_id', caller, 'revision', head.revision, 'payload', head.payload,
    'updated_at', head.updated_at, 'conflict', false);
END $$;
REVOKE ALL ON FUNCTION public.rigong_sync_uid(), public.rigong_sync_pull(), public.rigong_sync_push(bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rigong_sync_uid(), public.rigong_sync_pull(), public.rigong_sync_push(bigint,jsonb) TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
