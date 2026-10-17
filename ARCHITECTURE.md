# Architecture

```
Next.js UI ──HTTP──► Express API (/api/chat, /api/upload, /api/graph, /mcp)
                         │
                         ├─ Groq ReAct agent ──(in-memory MCP transport)──► MCP Server (Zod tools, audit log)
                         │        └─ self-reflection guardrail (reflect_and_validate)
                         ├─ Hybrid RAG: pgvector cosine  +  tsvector  ──► Reciprocal Rank Fusion (k=60)
                         └─ CNN worker (Python): denoise → conv feature maps → ROI boxes → Tesseract OCR
PostgreSQL 16 + pgvector (HNSW) + pg_trgm
```

**Flow:** user prompt → Groq plans & calls MCP tools (parallel when independent) → tool results (RAG hits, events) feed back → final draft → `reflect_and_validate` checks the draft against retrieved context (hallucination + timezone) and corrects it → response.

**External MCP clients:** `POST /mcp` (streamable HTTP, stateless) or `npm run mcp:stdio`.

**Security:** Zod on every tool input; uploads restricted to images, 15 MB, stored under UPLOAD_DIR with random names; `ingest_visual_document` rejects paths outside UPLOAD_DIR; all SQL parameterised (only whitelisted table names are interpolated); every tool call audited in `mcp_tool_audit`.

**Honest limits:** the "CNN" is a fixed-kernel conv/ReLU/max-pool feature stage (no training); the default embedder is a local hashed one (lexical-ish) — set `EMBEDDING_URL` for real semantics. There is no auth on the API; put it behind a proxy before exposing it.
