import { describe, expect, test } from "bun:test"
import {
  dataGoalNeedsPaddieSkill,
  paddieDataPlaygroundImplementationCode,
  paddieDataLlmRuntimeInstruction,
  knowledgeBaseID,
  paddieDataSkillInstruction,
  paddieMemoryLabel,
  paddieMemoryText,
  sourceChunkText,
} from "./helpers"

describe("paddie data helpers", () => {
  test("detects Memory, RAG, Knowledge Base, and API integration goals", () => {
    expect(dataGoalNeedsPaddieSkill("integrate Paddie Memory into this app")).toBe(true)
    expect(dataGoalNeedsPaddieSkill("add an AI RAG search over uploaded documents")).toBe(true)
    expect(dataGoalNeedsPaddieSkill("create server routes for api keys")).toBe(true)
    expect(dataGoalNeedsPaddieSkill("make the navbar responsive")).toBe(false)
  })

  test("formats memory labels from synthesized or raw content", () => {
    expect(paddieMemoryText({ memory: "User likes compact dashboards", content: "raw" })).toBe("User likes compact dashboards")
    expect(paddieMemoryLabel({ content: "x".repeat(90) })).toBe(`${"x".repeat(69)}...`)
    expect(paddieMemoryLabel({ id: "mem_1" })).toBe("mem_1")
  })

  test("normalizes knowledge base ids and source chunk summaries", () => {
    expect(knowledgeBaseID({ _key: "kb_key", id: "kb_id", name: "Docs" })).toBe("kb_key")
    expect(knowledgeBaseID({ id: "kb_id", name: "Docs" })).toBe("kb_id")
    expect(
      sourceChunkText({
        results: [
          { document_name: "Guide.md", text: "Use server routes for Paddie APIs." },
          { text: "Keep keys out of client bundles." },
        ],
      }),
    ).toContain("[Guide.md, chunk 1] Use server routes")
  })

  test("skill instruction names the bundled Paddie data skill and safety boundary", () => {
    const instruction = paddieDataSkillInstruction()

    expect(instruction).toContain("paddie-data-integrator")
    expect(instruction).toContain("RMN/Paddie APIs")
    expect(instruction).toContain("user IDs dynamically")
    expect(instruction).toContain("query selected knowledge bases at runtime")
    expect(instruction).toContain("application LLM runtime")
    expect(instruction).toContain("do not pull unrelated tenant memory")
  })

  test("formats the LLM runtime contract without secret values", () => {
    const instruction = paddieDataLlmRuntimeInstruction({
      provider: "anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-3-5-sonnet-latest",
    })

    expect(instruction).toContain("LLM runtime required")
    expect(instruction).toContain("ANTHROPIC_API_KEY")
    expect(instruction).toContain("Paddie Memory and Knowledge Base return memory/RAG context")
    expect(instruction).toContain("Do not put LLM or Paddie API keys")
  })

  test("generates a portable playground implementation code pack", () => {
    const code = paddieDataPlaygroundImplementationCode({
      apiBase: "https://api.paddie.io/api",
      apiKeyEnv: "PADDIE_API_KEY",
      memoryService: true,
      memoryMode: "router",
      routerMode: "conversation",
      memoryType: "preference",
      llm: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
      knowledgeBases: [{ id: "kb_1", name: "Onboarding", documentCount: 1, chunkCount: 12 }],
    })

    expect(code).toContain("File: src/lib/paddie-data.ts")
    expect(code).toContain("File: src/app/api/paddie-playground/route.ts")
    expect(code).toContain("File: src/components/PaddieDataPlayground.tsx")
    expect(code).toContain("process.env[\"PADDIE_API_KEY\"]")
    expect(code).toContain("process.env[\"OPENAI_API_KEY\"]")
    expect(code).toContain("kb_1")
  })
})
