CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.user_id IS NULL
    AND OLD.user_id IS NOT NULL
    AND NEW.id = OLD.id
    AND NEW.module = OLD.module
    AND NEW.entity = OLD.entity
    AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
    AND NEW.action = OLD.action
    AND NEW.old_values IS NOT DISTINCT FROM OLD.old_values
    AND NEW.new_values IS NOT DISTINCT FROM OLD.new_values
    AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
    AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
    AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
    AND NEW.browser IS NOT DISTINCT FROM OLD.browser
    AND NEW.operating_system IS NOT DISTINCT FROM OLD.operating_system
    AND NEW.device IS NOT DISTINCT FROM OLD.device
    AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
    AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id
    AND NEW.http_method IS NOT DISTINCT FROM OLD.http_method
    AND NEW.route IS NOT DISTINCT FROM OLD.route
    AND NEW.status_code IS NOT DISTINCT FROM OLD.status_code
    AND NEW.success = OLD.success
    AND NEW.execution_time IS NOT DISTINCT FROM OLD.execution_time
    AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Audit logs are immutable';
END;
$$ LANGUAGE plpgsql;
