<!-- Built-in Paddie skill. Name and description are registered in packages/opencode/src/skill/index.ts. -->

# Paddie Data Integrator

Use this skill when implementing Paddie Memory, Memory Router, Knowledge Base, AI RAG, API-key, or workflow-compatible Paddie data integrations.

## Rules

- Treat RMN/Paddie APIs as the source of truth for auth, usage, plan gates, memories, knowledge bases, and API keys.
- Never hardcode API keys, JWTs, tenant IDs, or secrets into client bundles. Use server routes, environment variables, or platform secret storage.
- Keep user memory explicitly scoped by `user_id`; do not fetch unrelated tenant memory unless the user asks and authorization is already in place.
- Treat Memory attachments from Studio as a service-integration request, not as a request to paste individual memory records into code.
- Create or resolve a stable Paddie Memory `user_id` dynamically for each end user at runtime, persist that mapping in the app's auth profile, database, or local profile store, and pass it on every Memory Router call.
- Preserve RMN plan gates. Show upgrade/limit errors from the API instead of bypassing or duplicating access checks.
- Prefer small adapters, hooks, services, or route handlers that can be reused by the app.

## Memory Router

Use `POST /api/memory/router` for agentic memory behavior.

Do not hardcode the Studio explorer `user_id` into the app. The explorer user ID is useful for testing only. Product code should derive a stable per-user memory ID from the app's authenticated user, account record, or generated local profile and then persist it.

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

Typical integration shape:

```ts
async function getPaddieMemoryUserID(appUser: { id?: string; email?: string }) {
  // Prefer a saved mapping in your app database/profile. For local-only apps,
  // generate once and persist in the user's local profile.
  return appUser.id ? `app_${appUser.id}` : "local_profile_user"
}

export async function runPaddieMemory(input: { appUser: { id?: string; email?: string }; query: string }) {
  const response = await fetch(`${process.env.PADDIE_API_BASE ?? "https://api.paddie.io/api"}/memory/router`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.PADDIE_API_KEY!,
    },
    body: JSON.stringify({
      query: input.query,
      user_id: await getPaddieMemoryUserID(input.appUser),
      mode: "conversation",
      include_analysis: false,
    }),
  })

  if (!response.ok) throw new Error(await response.text())
  return response.json()
}
```

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
