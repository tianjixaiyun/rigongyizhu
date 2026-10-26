-- 仅由原项目管理上下文在审核旧身份与备份后执行。幂等；不删旧表，不认领匿名身份。
BEGIN;
DO $migrate$
BEGIN
 IF to_regclass('public.rooms') IS NOT NULL THEN
  EXECUTE $query$
   INSERT INTO public.rigong_rooms_v19(code,owner_id,name,intro,emoji,visibility)
   SELECT j->>'code',substring(j->>'owner_ref' from 3),left(coalesce(nullif(j->>'name',''),'原有房间'),20),
    left(coalesce(j->>'intro',''),60),left(coalesce(j->>'emoji','🏠'),20),
    CASE WHEN j->>'visibility'='public' THEN 'public' ELSE 'private' END
   FROM (SELECT to_jsonb(t) j FROM public.rooms t) old
   WHERE j->>'code' ~ '^[A-Z0-9]{6}$' AND j->>'owner_ref' ~ '^u:.+'
   ON CONFLICT DO NOTHING
  $query$;
 END IF;
 IF to_regclass('public.room_members') IS NOT NULL THEN
  EXECUTE $query$
   INSERT INTO public.rigong_room_members_v19(code,owner_id,nickname,emoji)
   SELECT j->>'code',substring(j->>'ref' from 3),left(coalesce(nullif(j->>'nickname',''),'原有成员'),12),left(coalesce(j->>'emoji','🙂'),20)
   FROM (SELECT to_jsonb(t) j FROM public.room_members t) old
   WHERE j->>'ref' ~ '^u:.+' AND EXISTS(SELECT 1 FROM public.rigong_rooms_v19 r WHERE r.code=j->>'code')
   ON CONFLICT DO NOTHING
  $query$;
 END IF;
 INSERT INTO public.rigong_room_members_v19(code,owner_id,nickname)
 SELECT code,owner_id,'房主' FROM public.rigong_rooms_v19 ON CONFLICT DO NOTHING;
END $migrate$;
COMMIT;
-- 匿名 ref、未知身份和未迁移条目保留原样，必须单独审核；禁止按客户端 ID 自动认领。
