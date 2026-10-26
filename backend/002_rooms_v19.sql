-- v19 房间 API。仅新增专用表；不改旧 rooms/room_members/snapshots。
BEGIN;
CREATE TABLE IF NOT EXISTS public.rigong_rooms_v19 (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{6}$'),
  owner_id text NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 20),
  intro text NOT NULL DEFAULT '', emoji text NOT NULL DEFAULT '🏠',
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rigong_room_members_v19 (
  code text NOT NULL REFERENCES public.rigong_rooms_v19(code),
  owner_id text NOT NULL, nickname text NOT NULL, emoji text NOT NULL DEFAULT '🙂',
  stats jsonb NOT NULL DEFAULT '{}', joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz, PRIMARY KEY(code,owner_id)
);
CREATE TABLE IF NOT EXISTS public.rigong_room_shares_v19 (
  code text NOT NULL, owner_id text NOT NULL, habit_id text NOT NULL CHECK(length(habit_id) BETWEEN 1 AND 160),
  enabled boolean NOT NULL DEFAULT false, shared_on date NOT NULL,
  details jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(code,owner_id,habit_id),
  FOREIGN KEY(code,owner_id) REFERENCES public.rigong_room_members_v19(code,owner_id)
);
CREATE TABLE IF NOT EXISTS public.rigong_room_progress_v19 (
  code text NOT NULL, owner_id text NOT NULL, habit_id text NOT NULL,
  day date NOT NULL, progress jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(code,owner_id,habit_id,day),
  FOREIGN KEY(code,owner_id,habit_id) REFERENCES public.rigong_room_shares_v19(code,owner_id,habit_id)
);
ALTER TABLE public.rigong_rooms_v19 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rigong_room_members_v19 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rigong_room_shares_v19 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rigong_room_progress_v19 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rigong_rooms_v19,public.rigong_room_members_v19,
  public.rigong_room_shares_v19,public.rigong_room_progress_v19 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.rigong_rooms_v19(p_action text, p_code text DEFAULT NULL, p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  who text := claims->>'sub'; r public.rigong_rooms_v19%ROWTYPE; item jsonb; result jsonb;
  d date; nickname text; clean_stats jsonb; target numeric; value numeric; htype text;
BEGIN
  IF who IS NULL OR who='' OR coalesce((claims->>'is_anonymous')::boolean,false) THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>262144 THEN RAISE EXCEPTION 'invalid request'; END IF;
  IF p_action NOT IN ('create','join','list','get','leave','archive','restore','visibility','sync','ranking','plaza','shares','share','progress') THEN RAISE EXCEPTION 'invalid action'; END IF;
  IF p_action IN ('list','plaza') THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO result FROM (
      SELECT a.code,a.name,a.intro,a.emoji,a.visibility,a.owner_id=who AS owner,a.archived_at,
        (SELECT count(*) FROM public.rigong_room_members_v19 m WHERE m.code=a.code AND m.left_at IS NULL) AS member_count
      FROM public.rigong_rooms_v19 a
      WHERE CASE WHEN p_action='plaza' THEN a.visibility='public' AND a.archived_at IS NULL
      ELSE EXISTS(SELECT 1 FROM public.rigong_room_members_v19 m WHERE m.code=a.code AND m.owner_id=who AND m.left_at IS NULL)
        AND (a.archived_at IS NULL OR a.owner_id=who) END
      ORDER BY a.created_at DESC LIMIT 100
    ) x;
    RETURN jsonb_build_object('account_id',who,'data',result);
  END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'invalid room code'; END IF;
  -- 所有房间写操作先锁房间行；成员变更、共享撤回和进度上传按同一顺序串行化。
  IF p_action='create' THEN
    nickname := btrim(p_data->>'nickname');
    IF nickname IS NULL OR length(nickname) NOT BETWEEN 1 AND 12 OR length(btrim(p_data->>'name')) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid profile'; END IF;
    INSERT INTO public.rigong_rooms_v19(code,owner_id,name,intro,emoji,visibility)
    VALUES(p_code,who,btrim(p_data->>'name'),left(coalesce(p_data->>'intro',''),60),left(coalesce(p_data->>'emoji','🏠'),20),
      CASE WHEN p_data->>'visibility'='public' THEN 'public' ELSE 'private' END)
    ON CONFLICT DO NOTHING;
  END IF;
  SELECT * INTO r FROM public.rigong_rooms_v19 WHERE code=p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'room not found'; END IF;
  IF p_action='create' AND r.owner_id<>who THEN RAISE EXCEPTION 'room code conflict'; END IF;
  IF r.archived_at IS NOT NULL AND NOT(p_action='restore' AND r.owner_id=who) THEN RAISE EXCEPTION 'room archived'; END IF;
  IF p_action IN ('create','join') THEN
    nickname := btrim(p_data->>'nickname');
    IF nickname IS NULL OR length(nickname) NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'invalid profile'; END IF;
    INSERT INTO public.rigong_room_members_v19(code,owner_id,nickname,emoji)
    VALUES(p_code,who,nickname,left(coalesce(p_data->>'profile_emoji','🙂'),20))
    ON CONFLICT(code,owner_id) DO UPDATE SET left_at=NULL,nickname=excluded.nickname,emoji=excluded.emoji;
    result := to_jsonb(r)-'owner_id';
    result := result||jsonb_build_object('owner',r.owner_id=who);
    RETURN jsonb_build_object('account_id',who,'data',result);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rigong_room_members_v19 WHERE code=p_code AND owner_id=who AND left_at IS NULL) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_action IN ('archive','restore','visibility') THEN
    IF r.owner_id<>who THEN RAISE EXCEPTION 'owner only'; END IF;
    IF p_action='visibility' THEN
      IF coalesce(p_data->>'visibility','') NOT IN ('private','public') THEN RAISE EXCEPTION 'invalid visibility'; END IF;
      UPDATE public.rigong_rooms_v19 SET visibility=p_data->>'visibility' WHERE code=p_code;
    ELSE
      UPDATE public.rigong_rooms_v19 SET archived_at=CASE WHEN p_action='archive' THEN now() ELSE NULL END WHERE code=p_code;
      IF p_action='archive' THEN UPDATE public.rigong_room_shares_v19 SET enabled=false,updated_at=now() WHERE code=p_code; END IF;
    END IF;
    result := jsonb_build_object('ok',true);
  ELSIF p_action='leave' THEN
    IF r.owner_id=who THEN RAISE EXCEPTION 'owner must archive'; END IF;
    UPDATE public.rigong_room_members_v19 SET left_at=now() WHERE code=p_code AND owner_id=who;
    UPDATE public.rigong_room_shares_v19 SET enabled=false,updated_at=now() WHERE code=p_code AND owner_id=who;
    result := jsonb_build_object('ok',true);
  ELSIF p_action='get' THEN
    result := (to_jsonb(r)-'owner_id')||jsonb_build_object('owner',r.owner_id=who);
  ELSIF p_action='ranking' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('name',m.nickname,'emoji',m.emoji,'me',m.owner_id=who,
      'rate',m.stats->'rate','done',m.stats->'done','total',m.stats->'total','streak',m.stats->'streak',
      'points',m.stats->'points','day',m.stats->>'day')),'[]') INTO result
    FROM public.rigong_room_members_v19 m WHERE code=p_code AND left_at IS NULL;
  ELSIF p_action='shares' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('habit_id',s.habit_id,'enabled',s.enabled,'shared_on',s.shared_on)),'[]')
      INTO result FROM public.rigong_room_shares_v19 s WHERE code=p_code AND owner_id=who;
  ELSIF p_action='share' THEN
    IF length(coalesce(p_data->>'habit_id','')) NOT BETWEEN 1 AND 160 OR jsonb_typeof(p_data->'enabled')<>'boolean' THEN RAISE EXCEPTION 'invalid share'; END IF;
    d := (p_data->>'day')::date;
    IF d IS NULL OR abs(d-(now() AT TIME ZONE 'UTC')::date)>1 THEN RAISE EXCEPTION 'today only'; END IF;
    item := p_data->'details';
    IF (p_data->>'enabled')::boolean THEN
      IF coalesce(item->>'name','')='' OR length(item->>'name')>160 OR coalesce(item->>'type','') NOT IN ('check','avoid','count','duration') THEN RAISE EXCEPTION 'invalid habit'; END IF;
      target := coalesce((item->>'target')::numeric,1);
      IF target<0 OR target>1e12 THEN RAISE EXCEPTION 'invalid target'; END IF;
      item := jsonb_build_object('name',item->>'name','type',item->>'type','target',target,'unit',left(coalesce(item->>'unit',''),30));
    ELSE item := '{}'; END IF;
    INSERT INTO public.rigong_room_shares_v19(code,owner_id,habit_id,enabled,shared_on,details)
    VALUES(p_code,who,p_data->>'habit_id',(p_data->>'enabled')::boolean,d,item)
    ON CONFLICT(code,owner_id,habit_id) DO UPDATE SET
      enabled=excluded.enabled,
      shared_on=CASE WHEN NOT rigong_room_shares_v19.enabled AND excluded.enabled THEN excluded.shared_on ELSE rigong_room_shares_v19.shared_on END,
      details=CASE WHEN excluded.enabled THEN excluded.details ELSE rigong_room_shares_v19.details END,updated_at=now();
    result := jsonb_build_object('ok',true);
  ELSIF p_action='sync' THEN
    d := (p_data->>'day')::date;
    IF d IS NULL OR abs(d-(now() AT TIME ZONE 'UTC')::date)>1 THEN RAISE EXCEPTION 'today only'; END IF;
    IF jsonb_typeof(coalesce(p_data->'habits','[]'))<>'array' OR jsonb_array_length(coalesce(p_data->'habits','[]'))>500 THEN RAISE EXCEPTION 'invalid habits'; END IF;
    clean_stats := jsonb_build_object('rate',greatest(0,least(100,coalesce((p_data->>'rate')::int,0))),
      'done',greatest(0,coalesce((p_data->>'done')::int,0)),'total',greatest(0,coalesce((p_data->>'total')::int,0)),
      'streak',greatest(0,coalesce((p_data->>'streak')::int,0)),'points',coalesce((p_data->>'points')::int,0),'day',d);
    UPDATE public.rigong_room_members_v19 m SET stats=clean_stats,nickname=left(coalesce(nullif(btrim(p_data->>'nickname'),''),m.nickname),12),
      emoji=left(coalesce(p_data->>'profile_emoji',m.emoji),20) WHERE m.code=p_code AND m.owner_id=who;
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_data->'habits','[]')) LOOP
      -- 白名单字段；正文、备注、附件即使被恶意传入也不存储。
      IF EXISTS(SELECT 1 FROM public.rigong_room_shares_v19 s WHERE s.code=p_code AND s.owner_id=who AND s.habit_id=item->>'habit_id' AND s.enabled AND d>=s.shared_on) THEN
        IF coalesce(item->>'name','')<>'' THEN
          IF length(item->>'name')>160 OR coalesce(item->>'type','') NOT IN ('check','avoid','count','duration') THEN RAISE EXCEPTION 'invalid habit'; END IF;
          target := coalesce((item->>'target')::numeric,1);
          IF target<0 OR target>1e12 THEN RAISE EXCEPTION 'invalid target'; END IF;
          UPDATE public.rigong_room_shares_v19 SET details=jsonb_build_object('name',item->>'name','type',item->>'type',
            'target',target,'unit',left(coalesce(item->>'unit',''),30)),updated_at=now()
            WHERE code=p_code AND owner_id=who AND habit_id=item->>'habit_id';
        END IF;
        value := coalesce((item->>'value')::numeric,0);
        IF value<0 OR value>1e12 OR coalesce(item->>'status','') NOT IN ('done','pending','skipped','rest') THEN RAISE EXCEPTION 'invalid progress'; END IF;
        INSERT INTO public.rigong_room_progress_v19(code,owner_id,habit_id,day,progress)
        VALUES(p_code,who,item->>'habit_id',d,jsonb_build_object('value',value,'status',item->>'status'))
        ON CONFLICT(code,owner_id,habit_id,day) DO UPDATE SET progress=excluded.progress,updated_at=now();
      END IF;
    END LOOP;
    result := jsonb_build_object('ok',true);
  ELSIF p_action='progress' THEN
    d := (p_data->>'day')::date;
    IF d IS NULL OR abs(d-(now() AT TIME ZONE 'UTC')::date)>1 THEN RAISE EXCEPTION 'today only'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('habit_id',s.habit_id,'name',s.details->>'name','type',s.details->>'type',
      'target',s.details->'target','unit',s.details->>'unit','nickname',m.nickname,'emoji',m.emoji,'me',s.owner_id=who,
      'value',p.progress->'value','status',p.progress->>'status','day',p.day,'updated_at',p.updated_at)),'[]')
      INTO result FROM public.rigong_room_shares_v19 s
      JOIN public.rigong_room_members_v19 m ON m.code=s.code AND m.owner_id=s.owner_id AND m.left_at IS NULL
      LEFT JOIN public.rigong_room_progress_v19 p ON p.code=s.code AND p.owner_id=s.owner_id AND p.habit_id=s.habit_id AND p.day=d AND p.day>=s.shared_on
      WHERE s.code=p_code AND s.enabled AND d>=s.shared_on;
  END IF;
  RETURN jsonb_build_object('account_id',who,'data',result);
END $fn$;
REVOKE ALL ON FUNCTION public.rigong_rooms_v19(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rigong_rooms_v19(text,text,jsonb) TO authenticated;
COMMIT;
