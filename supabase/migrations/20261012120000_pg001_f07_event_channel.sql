-- PG-001 F07-EVENT-001 (Human-approved): dedicated Event-only channel for /api/v1/events/batch.
-- A browser anonymous_id is F07 correlation only (BS-P1-025 F07-ANONYMOUS-IDENTITY-EVIDENCE §§4-5, 23-25): this role may
-- ensure that one anonymous_identity row, bump its bounded last_seen_at and insert that one product_event. It has no
-- F01 / F02 / evidence-source privileges and is not a member of any other role.
-- Per-statement context (set_config(..., true)) is derived by the F07 executor from the statement's own parameters:
--   app.f07_event_anonymous_id = the event's (or ensured identity's) anonymous_id, empty for identity-free events;
--   app.f07_event_id           = the product_event being inserted, empty otherwise.
CREATE ROLE appf2_f07_event NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
GRANT USAGE ON SCHEMA public TO appf2_f07_event;

GRANT SELECT (anonymous_id, status, last_seen_at) ON public.anonymous_identity TO appf2_f07_event;
GRANT INSERT (anonymous_id, created_at, last_seen_at, status, created_source) ON public.anonymous_identity TO appf2_f07_event;
GRANT UPDATE (last_seen_at) ON public.anonymous_identity TO appf2_f07_event;
GRANT INSERT ON public.product_event TO appf2_f07_event;
-- Only for `ON CONFLICT (event_id) DO NOTHING RETURNING event_id` on the bound row.
GRANT SELECT (event_id) ON public.product_event TO appf2_f07_event;

CREATE POLICY f07_event_identity_bound ON public.anonymous_identity FOR SELECT TO appf2_f07_event
  USING (anonymous_id = NULLIF(current_setting('app.f07_event_anonymous_id', true), '')::uuid);
-- No Worker/DB clock condition: received / last-seen time stays the Worker's server timestamp (F07 locked contract);
-- last_seen_at is bounded by the 24 h refresh throttle in POSTGRES_REFRESH_LAST_SEEN_SQL.
CREATE POLICY f07_event_identity_ensure ON public.anonymous_identity FOR INSERT TO appf2_f07_event
  WITH CHECK (
    anonymous_id = NULLIF(current_setting('app.f07_event_anonymous_id', true), '')::uuid
    AND status = 'ACTIVE' AND created_source = 'WEB_PHASE1' AND created_at = last_seen_at);
CREATE POLICY f07_event_identity_seen ON public.anonymous_identity FOR UPDATE TO appf2_f07_event
  USING (anonymous_id = NULLIF(current_setting('app.f07_event_anonymous_id', true), '')::uuid AND status = 'ACTIVE')
  WITH CHECK (anonymous_id = NULLIF(current_setting('app.f07_event_anonymous_id', true), '')::uuid AND status = 'ACTIVE');

CREATE POLICY f07_event_insert_bound ON public.product_event FOR INSERT TO appf2_f07_event
  WITH CHECK (
    event_id = NULLIF(current_setting('app.f07_event_id', true), '')::uuid
    AND anonymous_id IS NOT DISTINCT FROM NULLIF(current_setting('app.f07_event_anonymous_id', true), '')::uuid);
CREATE POLICY f07_event_returning_bound ON public.product_event FOR SELECT TO appf2_f07_event
  USING (event_id = NULLIF(current_setting('app.f07_event_id', true), '')::uuid);
