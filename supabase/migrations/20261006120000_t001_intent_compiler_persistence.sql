CREATE TABLE public.intent_record (
  intent_id uuid PRIMARY KEY,
  anonymous_id uuid NOT NULL
    REFERENCES public.anonymous_identity (anonymous_id),
  intent_kind text NOT NULL
    CHECK (intent_kind IN ('CREATE', 'REFINE', 'REMIX', 'CORRECT')),
  raw_intent text NULL,
  structured_intent jsonb NULL
    CHECK (structured_intent IS NULL OR jsonb_typeof(structured_intent) = 'object'),
  resolved_intent jsonb NULL
    CHECK (resolved_intent IS NULL OR jsonb_typeof(resolved_intent) = 'object'),
  lifecycle_status text NOT NULL
    CHECK (lifecycle_status IN (
      'RECEIVED', 'ANALYZING', 'NEEDS_CLARIFICATION', 'READY_WITH_VISIBLE_ASSUMPTIONS', 'READY',
      'COMPOSING', 'VALIDATING', 'VALIDATED', 'ANALYSIS_FAILED', 'COMPOSITION_FAILED',
      'VALIDATION_REJECTED', 'INCOMPATIBLE', 'CANCELLED'
    )),
  intent_version integer NOT NULL
    CHECK (intent_version >= 1),
  source_blueprint_hash text NULL
    CHECK (source_blueprint_hash IS NULL OR source_blueprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  CHECK (resolved_intent IS NULL OR structured_intent IS NOT NULL)
);

CREATE INDEX intent_record_anonymous_created_idx
  ON public.intent_record (anonymous_id, created_at);
CREATE INDEX intent_record_raw_intent_expiry_idx
  ON public.intent_record (expires_at)
  WHERE raw_intent IS NOT NULL AND expires_at IS NOT NULL;

CREATE TABLE public.compiler_run (
  compiler_run_id uuid PRIMARY KEY,
  intent_id uuid NOT NULL
    REFERENCES public.intent_record (intent_id),
  stage text NOT NULL
    CHECK (stage IN ('INTENT_ANALYSIS', 'BLUEPRINT_COMPOSE')),
  status text NOT NULL
    CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT')),
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  registry_version text NOT NULL,
  model_adapter text NOT NULL,
  provider_model text NULL,
  attempt_no integer NOT NULL
    CHECK (attempt_no >= 1),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  latency_ms integer NULL
    CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens integer NULL
    CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer NULL
    CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_cost numeric NULL
    CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  failure_code text NULL
    CHECK (failure_code IS NULL OR failure_code ~ '^F01-ERR-[0-9]{3}$'),
  trace_id text NOT NULL,
  CONSTRAINT compiler_run_attempt_key UNIQUE (intent_id, stage, attempt_no),
  CHECK ((status = 'STARTED') = (finished_at IS NULL))
);

CREATE INDEX compiler_run_intent_started_idx
  ON public.compiler_run (intent_id, started_at);
CREATE INDEX compiler_run_adapter_started_idx
  ON public.compiler_run (model_adapter, started_at);

CREATE TABLE public.idempotency_operation (
  idempotency_operation_id uuid PRIMARY KEY,
  anonymous_id uuid NOT NULL,
  route_key text NOT NULL,
  idempotency_key text NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  request_digest text NOT NULL
    CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL
    CHECK (status IN ('IN_PROGRESS', 'FAILED_RETRYABLE', 'SUCCEEDED', 'FAILED_TERMINAL')),
  attempt_no integer NOT NULL
    CHECK (attempt_no >= 1),
  lease_expires_at timestamptz NULL,
  result_ref_type text NULL
    CHECK (result_ref_type IS NULL OR result_ref_type IN ('INTENT', 'VALIDATION_RUN', 'SHARE', 'CORRECTION', 'OTHER')),
  result_ref_id text NULL,
  http_status integer NULL
    CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  error_code text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_operation_scope_key UNIQUE (anonymous_id, route_key, idempotency_key),
  CHECK (status <> 'IN_PROGRESS' OR lease_expires_at IS NOT NULL),
  CHECK ((result_ref_type IS NULL) = (result_ref_id IS NULL))
);

CREATE INDEX idempotency_operation_expires_idx
  ON public.idempotency_operation (expires_at);

-- DATA-MODEL §6.4 staged FK: verify every pre-existing non-NULL validation_run.compiler_run_id before
-- adding the physical FK; NULL (restore / import) stays legal and no placeholder compiler_run is invented.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.validation_run AS run
    WHERE run.compiler_run_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.compiler_run AS compiler
        WHERE compiler.compiler_run_id = run.compiler_run_id
      )
  ) THEN
    RAISE EXCEPTION 'validation_run.compiler_run_id integrity validation failed: orphan compiler_run references exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

ALTER TABLE public.validation_run
  ADD CONSTRAINT validation_run_compiler_run_fk
  FOREIGN KEY (compiler_run_id) REFERENCES public.compiler_run (compiler_run_id)
  NOT VALID;
ALTER TABLE public.validation_run
  VALIDATE CONSTRAINT validation_run_compiler_run_fk;

ALTER TABLE public.intent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compiler_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_operation ENABLE ROW LEVEL SECURITY;
