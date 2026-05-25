ALTER TABLE billing_purchases
DROP CONSTRAINT IF EXISTS billing_purchases_status_check;

ALTER TABLE billing_purchases
ADD CONSTRAINT billing_purchases_status_check
CHECK (status IN ('pending', 'completed', 'failed', 'expired'));
