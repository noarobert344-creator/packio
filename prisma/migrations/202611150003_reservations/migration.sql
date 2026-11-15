ALTER TABLE shipments ADD COLUMN expired_m INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN expired_e INTEGER NOT NULL DEFAULT 0;
CREATE TABLE mutation_receipts (actor TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,request_id));