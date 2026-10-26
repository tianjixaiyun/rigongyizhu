-- 兼容 RPC 复用已验证的原子同步实现，不直接操作旧 snapshots。
BEGIN;
CREATE OR REPLACE FUNCTION public.rigong_sync_compat_pull() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS 'SELECT public.rigong_sync_pull()';
CREATE OR REPLACE FUNCTION public.rigong_sync_compat_push(p_revision bigint,p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS 'SELECT public.rigong_sync_push(p_revision,p_payload)';
REVOKE ALL ON FUNCTION public.rigong_sync_compat_pull(),public.rigong_sync_compat_push(bigint,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rigong_sync_compat_pull(),public.rigong_sync_compat_push(bigint,jsonb) TO authenticated;
COMMIT;
