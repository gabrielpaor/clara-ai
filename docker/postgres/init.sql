-- Runs once, on the very first startup of the postgres container
-- (scripts in /docker-entrypoint-initdb.d execute only when the data
--  volume is empty). Connected database at this point: invoice_clerk.

-- Separate database for n8n's internal tables, so automation-engine
-- data never mixes with our application schema.
CREATE DATABASE n8n;

-- Vector similarity extension on the app database — used later for
-- duplicate-invoice detection via embedding similarity.
CREATE EXTENSION IF NOT EXISTS vector;
