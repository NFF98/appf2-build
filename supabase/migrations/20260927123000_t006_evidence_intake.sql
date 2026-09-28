CREATE TABLE public.anonymous_identity (
  anonymous_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'ROTATED', 'DISABLED')),
  created_source text NOT NULL DEFAULT 'WEB_PHASE1'
    CHECK (created_source = 'WEB_PHASE1')
);

CREATE TABLE public.product_event (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL
    CHECK (event_type ~ '^F[0-9]{2}-EVT-[0-9]{3}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  anonymous_id uuid NULL
    REFERENCES public.anonymous_identity (anonymous_id),
  session_id text NULL,
  function_id text NOT NULL
    CHECK (function_id ~ '^F[0-9]{2}$'),
  intent_id uuid NULL,
  blueprint_hash text NULL,
  share_id uuid NULL,
  capability_id text NULL,
  error_code text NULL,
  policy_rule_id text NULL,
  trace_id text NULL,
  properties jsonb NULL
    CHECK (
      properties IS NULL OR (
        jsonb_typeof(properties) = 'object'
        AND octet_length(properties::text) <= 4096
      )
    ),
  schema_version text NOT NULL,
  CHECK (event_type LIKE function_id || '-EVT-%')
);

CREATE INDEX product_event_function_occurred_idx
  ON public.product_event (function_id, occurred_at);
CREATE INDEX product_event_anonymous_occurred_idx
  ON public.product_event (anonymous_id, occurred_at);
CREATE INDEX product_event_blueprint_occurred_idx
  ON public.product_event (blueprint_hash, occurred_at);
CREATE INDEX product_event_type_occurred_idx
  ON public.product_event (event_type, occurred_at);
CREATE INDEX product_event_trace_idx
  ON public.product_event (trace_id);

ALTER TABLE public.anonymous_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_event ENABLE ROW LEVEL SECURITY;
