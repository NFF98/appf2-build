-- Staging free-CI case observations are not independent publication admission.
ALTER TABLE public.appf2_agent_free_ci_receipt
 DROP CONSTRAINT appf2_agent_free_ci_receipt_receipt_json_check;
ALTER TABLE public.appf2_agent_free_ci_receipt
 ADD CONSTRAINT appf2_agent_free_ci_receipt_receipt_json_check
 CHECK (jsonb_typeof(receipt_json)='object'
  AND octet_length(receipt_json::text)<=8192
  AND receipt_json->>'original_requirements_qa'='false'
  AND receipt_json->>'app_published'='false');
