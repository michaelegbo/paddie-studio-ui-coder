<!-- Built-in Paddie skill. Name and description are registered in packages/opencode/src/skill/index.ts. -->

# Paddie Data Integrator

Use this skill when implementing Paddie Memory, Memory Router, Knowledge Base, AI RAG, API-key, or workflow-compatible Paddie data integrations.

## Rules

- Treat RMN/Paddie APIs as the source of truth for auth, usage, plan gates, memories, knowledge bases, and API keys.
- Never hardcode API keys, JWTs, tenant IDs, or secrets into client bundles. Use server routes, environment variables, or platform secret storage.
- Keep user memory explicitly scoped by `user_id`; do not fetch unrelated tenant memory unless the user asks and authorization is already in place.
- Preserve RMN plan gates. Show upgrade/limit errors from the API instead of bypassing or duplicating access checks.
- Prefer small adapters, hooks, services, or route handlers that can be reused by the app.

## Memory Router

Use `POST /api/memory/router` for agentic memory behavior.

Typical request:

```json
{
  "query": "Remember that this user prefers concise UI.",
  "user_id": "user_123",
  "mode": "conversation",
  "include_analysis": false
}
```

Use modes this way:

- `conversation`: retrieve relevant memories and store new memories when useful.
- `retrieve`: search memory without storing.
- `store`: store a direct memory.
- `auto`: let RMN classify the intent.

## Manual Memory

Use `POST /api/memories` when the app has an explicit memory to save.

Use `GET /api/memories?userId=<id>` for a user-scoped memory list. Add `search`, `type`, `limit`, and `page` when the UI needs filtering.

## Knowledge Base / AI RAG

Use the Knowledge Base APIs for document-backed retrieval:

- `GET /api/knowledge-bases`
- `POST /api/knowledge-bases`
- `POST /api/knowledge-bases/:id/documents`
- `POST /api/knowledge-bases/:id/query`
- `GET /api/knowledge-bases/:id/api`

For file ingestion, send extracted text or base64 document bytes to RMN and let RMN handle extraction, chunking, embeddings, and graph expansion.

For querying, default to:

```json
{
  "query": "What does this knowledge base say?",
  "limit": 8,
  "generateAnswer": true,
  "includeGraph": true
}
```

## App Implementation Pattern

For frontend apps, create a server-side boundary when an API key is needed:

- React/Vite without a server: tell the user a server/API route is needed before using a secret.
- Next.js/Remix/Astro/server apps: create a route/action that calls Paddie with `process.env.PADDIE_API_KEY`.
- Angular apps: put secret calls behind a backend service; the Angular client calls that backend.

For client-only demos, use a clearly named placeholder such as `PADDIE_API_KEY` and document that it must move server-side before production.

## Error UX

Handle structured RMN errors:

- `402` with `upgrade_required: true`: show the message, current usage, and upgrade action.
- `401`: ask the user to sign in or reconnect.
- extraction failures: show the document quality/extraction message and let the user upload a cleaner file or paste text.

Keep fallbacks honest. If Memory or RAG is unavailable, the app should still run without pretending the data exists.
