-- pgvector must exist before any migration that uses the "vector" type.
-- The docker init.sql enables it on the dev database, but Prisma's shadow
-- database (used by `migrate dev` to replay history) starts empty — so the
-- extension has to be part of the migration history itself.
CREATE EXTENSION IF NOT EXISTS vector;
