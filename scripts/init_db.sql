CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  embedding vector(1536),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  attendees TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','tentative','cancelled')),
  CHECK (end_time > start_time)
);
CREATE TABLE IF NOT EXISTS vision_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  ocr_extracted_text TEXT NOT NULL DEFAULT '',
  cnn_feature_map JSONB,
  bounding_boxes JSONB,
  embedding vector(1536),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(ocr_extracted_text,''))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('short_term','long_term','episodic')),
  key_facts JSONB NOT NULL,
  embedding vector(1536),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_tool_audit (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT,
  tool_name TEXT NOT NULL,
  input_payload JSONB,
  output_payload JSONB,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_emb_hnsw ON notes USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS notes_tsv_gin ON notes USING gin (tsv);
CREATE INDEX IF NOT EXISTS notes_title_trgm ON notes USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vdocs_emb_hnsw ON vision_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS vdocs_tsv_gin ON vision_documents USING gin (tsv);
CREATE INDEX IF NOT EXISTS mem_emb_hnsw ON agent_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS mem_session ON agent_memories (session_id, memory_type);
CREATE INDEX IF NOT EXISTS events_time ON calendar_events (start_time, end_time);
CREATE INDEX IF NOT EXISTS audit_session ON mcp_tool_audit (session_id, created_at);
