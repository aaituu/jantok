-- Paid commitments and append-only ledgers must not be rewritten in place.
CREATE OR REPLACE FUNCTION reject_business_rule_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'versioned business rules are immutable; create a new version';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cutoff_policies_immutable
  BEFORE UPDATE OR DELETE ON "cutoff_policies"
  FOR EACH ROW EXECUTE FUNCTION reject_business_rule_mutation();
CREATE TRIGGER pricing_rule_sets_immutable
  BEFORE UPDATE OR DELETE ON "pricing_rule_sets"
  FOR EACH ROW EXECUTE FUNCTION reject_business_rule_mutation();

CREATE OR REPLACE FUNCTION reject_accepted_quote_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ACCEPTED' THEN
    RAISE EXCEPTION 'accepted quote is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accepted_quotes_immutable
  BEFORE UPDATE OR DELETE ON "price_quotes"
  FOR EACH ROW EXECUTE FUNCTION reject_accepted_quote_mutation();

CREATE OR REPLACE FUNCTION reject_paid_quote_line_mutation() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "price_quotes" q WHERE q.id = OLD.quote_id AND q.status = 'ACCEPTED') THEN
    RAISE EXCEPTION 'accepted quote lines are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accepted_quote_lines_immutable
  BEFORE UPDATE OR DELETE ON "price_quote_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_paid_quote_line_mutation();

CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only record cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_day_events_append_only
  BEFORE UPDATE OR DELETE ON "service_day_events"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER payment_attempts_append_only
  BEFORE UPDATE OR DELETE ON "payment_attempts"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
