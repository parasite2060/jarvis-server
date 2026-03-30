-- Create memu database and enable pgvector extension
-- This script runs on first PostgreSQL init only
SELECT 'CREATE DATABASE memu OWNER jarvis'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'memu')\gexec

\c memu
CREATE EXTENSION IF NOT EXISTS vector;
