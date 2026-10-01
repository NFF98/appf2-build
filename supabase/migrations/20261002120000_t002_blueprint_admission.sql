CREATE TABLE public.validation_run (
  validation_run_id uuid PRIMARY KEY,
  compiler_run_id uuid NULL,
  candidate_digest text NOT NULL
    CHECK (candidate_digest ~ '^sha256:[0-9a-f]{64}$'),
  blueprint_hash text NULL
    CHECK (blueprint_hash IS NULL OR blueprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  schema_version text NOT NULL,
  registry_version text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('PASSED', 'REJECTED', 'INCOMPATIBLE')),
  error_codes jsonb NULL
    CHECK (error_codes IS NULL OR jsonb_typeof(error_codes) = 'array'),
  report jsonb NULL
    CHECK (report IS NULL OR jsonb_typeof(report) = 'object'),
  created_at timestamptz NOT NULL,
  trace_id text NOT NULL,
  CONSTRAINT validation_run_blueprint_hash_status_ck
    CHECK (
      (status = 'PASSED' AND blueprint_hash IS NOT NULL)
      OR (status IN ('REJECTED', 'INCOMPATIBLE') AND blueprint_hash IS NULL)
    )
);

COMMENT ON COLUMN public.validation_run.compiler_run_id IS
  'Nullable logical compiler_run reference. No physical FK until compiler persistence exists.';

CREATE TABLE public.blueprint_content (
  content_hash text PRIMARY KEY
    CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_blueprint jsonb NOT NULL
    CHECK (jsonb_typeof(canonical_blueprint) = 'object'),
  schema_version text NOT NULL,
  registry_version text NOT NULL,
  trust_status text NOT NULL
    CHECK (trust_status IN ('VALIDATED', 'REVOKED', 'INCOMPATIBLE')),
  created_at timestamptz NOT NULL,
  admitted_by_validation_run_id uuid NOT NULL,
  byte_size integer NOT NULL
    CHECK (byte_size >= 0),
  CONSTRAINT blueprint_content_admitted_by_validation_run_fk
    FOREIGN KEY (admitted_by_validation_run_id)
    REFERENCES public.validation_run (validation_run_id)
);

CREATE INDEX validation_run_compiler_run_id_idx
  ON public.validation_run (compiler_run_id);
CREATE INDEX validation_run_status_created_at_idx
  ON public.validation_run (status, created_at);
CREATE INDEX blueprint_content_created_at_idx
  ON public.blueprint_content (created_at);
CREATE INDEX blueprint_content_schema_registry_trust_idx
  ON public.blueprint_content (schema_version, registry_version, trust_status);

CREATE FUNCTION public.validation_run_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'validation_run is append-only';
END;
$$;

CREATE TRIGGER validation_run_append_only
BEFORE UPDATE ON public.validation_run
FOR EACH ROW
EXECUTE FUNCTION public.validation_run_append_only();

CREATE FUNCTION public.blueprint_content_reject_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.canonical_blueprint IS DISTINCT FROM OLD.canonical_blueprint
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.registry_version IS DISTINCT FROM OLD.registry_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.admitted_by_validation_run_id IS DISTINCT FROM OLD.admitted_by_validation_run_id
    OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
  THEN
    RAISE EXCEPTION 'blueprint_content immutable fields cannot be updated';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blueprint_content_immutable
BEFORE UPDATE ON public.blueprint_content
FOR EACH ROW
EXECUTE FUNCTION public.blueprint_content_reject_immutable_update();

ALTER TABLE public.validation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_content ENABLE ROW LEVEL SECURITY;
