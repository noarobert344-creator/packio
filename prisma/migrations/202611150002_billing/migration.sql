CREATE TABLE billing_cycles (client TEXT PRIMARY KEY REFERENCES clients(uid), starts INTEGER NOT NULL);
CREATE TABLE ended_subscriptions (id TEXT PRIMARY KEY);
CREATE TABLE refund_totals (charge_id TEXT PRIMARY KEY, amount INTEGER NOT NULL);
CREATE UNIQUE INDEX plans_stripe_unique ON plans(stripe_price) WHERE stripe_price<>'';
CREATE INDEX mail_pending ON mail_queue(sent,created);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE INDEX notifications_owner ON notifications(uid,created);