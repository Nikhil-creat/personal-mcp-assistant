# Personal MCP Assistant

> Designed & developed by **NIKHIL CHARY SRIRAMOJU** · [GitHub](https://github.com/Nikhil-creat) · [LinkedIn](https://in.linkedin.com/in/nikhil-chary-sriramoju-95041b38a)

Groq-powered ReAct agent over your calendar, notes and scanned images, exposed through the Model Context Protocol. Hybrid RAG (pgvector + tsvector + RRF), CNN/OCR vision worker, Next.js UI with a 3D context graph, all in Docker Compose.

## Two ways to run
- **Static site (GitHub Pages):** `docs/` — no build, runs fully in the browser (Groq BYOK, local hybrid RAG, in-browser CNN/OCR, Three.js graph). See `GITHUB_PAGES_GUIDE.md`.
- **Full stack (Docker):** TypeScript MCP server + Postgres/pgvector + Python CNN worker, below.

## Run it
```bash
cp .env.example .env        # set GROQ_API_KEY
docker compose up --build
```
- UI: http://localhost:3000 · API: http://localhost:4000 · MCP: http://localhost:4000/mcp
- The schema is applied automatically on first Postgres start from `scripts/init_db.sql`.
  Re-apply manually: `docker compose exec -T postgres psql -U mcp -d mcp < scripts/init_db.sql`

## Test it
```bash
# health
curl localhost:4000/health
# add a note via the agent
curl -s localhost:4000/api/chat -H 'content-type: application/json' \
  -d '{"sessionId":"t1","message":"Create a note titled Sprint plan: finish API auth, review CNN worker. Tag it work."}'
# add an event, then ask for a prep summary
curl -s localhost:4000/api/chat -H 'content-type: application/json' \
  -d '{"sessionId":"t1","message":"Schedule Sprint review next Monday 3pm-4pm IST, then summarise prep from my notes."}'
# upload a whiteboard photo
curl -F file=@whiteboard.jpg localhost:4000/api/upload
```
CLI (no UI): `npm i && DATABASE_URL=postgresql://mcp:mcp@localhost:5432/mcp GROQ_API_KEY=... CNN_WORKER_URL=http://localhost:8000 npm run cli`
(run `docker compose up postgres cnn-worker` for the dependencies).

MCP Inspector / Claude Desktop: `npx @modelcontextprotocol/inspector` → Streamable HTTP → `http://localhost:4000/mcp`, or stdio via `npm run mcp:stdio`.

## Layout
`src/mcp` tools (Zod) · `src/agent` Groq loop + reflection · `src/rag` embedder + RRF · `src/cnn` vision client · `src/db` pool · `src/ui` Next.js · `docs/` static site · `cnn-worker/` Python OCR/CNN · `scripts/init_db.sql`

## Tools
get_events, create_event, reschedule_event, detect_schedule_conflicts, hybrid_search_notes, create_note, update_note, ingest_visual_document, store_agent_fact, retrieve_long_term_memory, reflect_and_validate, synthesize_cross_context_summary

## Notes
- `llama-3.3-70b-versatile` by default; change `GROQ_MODEL` (e.g. a Llama 4 Scout id from Groq's model list).
- Groq has no embeddings endpoint, so embeddings are local-hashed by default or via `EMBEDDING_URL` (1536 dims, OpenAI-compatible).
- First run: I couldn't run `npm install`/Docker in my sandbox, so expect to fix a typing nit or two on first build. Send me the error and I'll patch it.
