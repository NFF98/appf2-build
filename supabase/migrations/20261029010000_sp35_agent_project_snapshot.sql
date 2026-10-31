-- Sprint 3.5 immutable source checkpoints in private staging PostgreSQL.
-- Insert bytes first, then CAS-advance the Agent Job's project pointer.
-- On a crash between those operations an unreferenced private snapshot is harmless.
CREATE TABLE public.appf2_agent_project_snapshot (
 owner_anonymous_id uuid NOT NULL,
 project_hash text NOT NULL CHECK(project_hash ~ '^sha256:[0-9a-f]{64}$'),
 parent_hash text CHECK(parent_hash ~ '^sha256:[0-9a-f]{64}$'),
 project_revision integer NOT NULL CHECK(project_revision BETWEEN 1 AND 512),
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_anonymous_id,project_hash),
 FOREIGN KEY(owner_anonymous_id,parent_hash)
  REFERENCES public.appf2_agent_project_snapshot(owner_anonymous_id,project_hash),
 CHECK ((project_revision=1 AND parent_hash IS NULL) OR
  (project_revision>1 AND parent_hash IS NOT NULL)),
 CHECK (jsonb_typeof(snapshot)='object' AND
  octet_length(snapshot::text)<=4400000 AND
  snapshot->>'schema_version'='APPF2_PROJECT_V1' AND
  snapshot->>'project_hash'=project_hash AND
  snapshot->>'parent_hash' IS NOT DISTINCT FROM parent_hash AND
  (snapshot->>'revision')::integer=project_revision)
);
CREATE INDEX appf2_agent_project_snapshot_owner_created_idx
 ON public.appf2_agent_project_snapshot(owner_anonymous_id,created_at DESC);
ALTER TABLE public.appf2_agent_project_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_project_snapshot FROM PUBLIC,anon,authenticated,appf2_worker;
GRANT SELECT,INSERT ON public.appf2_agent_project_snapshot TO appf2_worker;
CREATE POLICY appf2_agent_project_snapshot_read ON public.appf2_agent_project_snapshot
 FOR SELECT TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_agent_project_snapshot_create ON public.appf2_agent_project_snapshot
 FOR INSERT TO appf2_worker
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
-- No UPDATE or DELETE policy or grant. All versions remain immutable.
