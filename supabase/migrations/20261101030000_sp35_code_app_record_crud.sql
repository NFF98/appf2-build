-- Sprint 3.5: per-published-App, per-viewer records. Not general SQL execution.
-- Worker-only RLS identity MUST be set from a verified P-256 request proof.
CREATE TABLE public.appf2_code_app_record (
  share_id uuid NOT NULL REFERENCES public.appf2_code_app(share_id) ON DELETE CASCADE,
  viewer_key_thumbprint text NOT NULL CHECK (char_length(viewer_key_thumbprint)=43),
  record_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload)='object' AND octet_length(payload::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (share_id,viewer_key_thumbprint,record_id)
);
CREATE INDEX appf2_code_app_record_viewer_idx ON public.appf2_code_app_record
  (share_id,viewer_key_thumbprint,created_at DESC);
ALTER TABLE public.appf2_code_app_record ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_code_app_record FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.appf2_code_app_record TO appf2_worker;
CREATE POLICY appf2_code_record_select ON public.appf2_code_app_record
 FOR SELECT TO appf2_worker USING (
 viewer_key_thumbprint = nullif(current_setting('app.code_record_thumbprint',true),''));
CREATE POLICY appf2_code_record_insert ON public.appf2_code_app_record
 FOR INSERT TO appf2_worker WITH CHECK (
 viewer_key_thumbprint = nullif(current_setting('app.code_record_thumbprint',true),''));
CREATE POLICY appf2_code_record_update ON public.appf2_code_app_record
 FOR UPDATE TO appf2_worker USING (
 viewer_key_thumbprint = nullif(current_setting('app.code_record_thumbprint',true),''))
 WITH CHECK (
 viewer_key_thumbprint = nullif(current_setting('app.code_record_thumbprint',true),''));
CREATE POLICY appf2_code_record_delete ON public.appf2_code_app_record
 FOR DELETE TO appf2_worker USING (
 viewer_key_thumbprint = nullif(current_setting('app.code_record_thumbprint',true),''));
