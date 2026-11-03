-- Sprint 3.5: a durable Job MUST reference an already persisted immutable
-- source snapshot belonging to the same owner. Snapshot is saved before Job CAS.
-- Existing candidate job table has no rows at staging migration time.
ALTER TABLE public.appf2_agent_job
 ADD CONSTRAINT appf2_agent_job_source_snapshot_fk
 FOREIGN KEY(owner_anonymous_id,project_hash)
 REFERENCES public.appf2_agent_project_snapshot(owner_anonymous_id,project_hash)
 ON UPDATE RESTRICT ON DELETE RESTRICT;
