export type StudioDesignPackPreview = {
  colors: string[]
  imageUrl?: string
  note?: string
}

export type StudioDesignSkill = {
  id: string
  name: string
  description: string
  trigger: string
  instruction: string
}

export type StudioDesignTokenMap = Record<string, string>

export type StudioDesignPackMeta = {
  id: string
  name: string
  description: string
  tags: string[]
  tier: string
  sourceKinds: string[]
  preview: StudioDesignPackPreview
  updatedAt: string
}

export type StudioDesignPack = StudioDesignPackMeta & {
  rules: string[]
  tokens: StudioDesignTokenMap
  typography: string[]
  icons: string[]
  motion: string[]
  componentGuidance: string[]
  skills: StudioDesignSkill[]
  inspirationRefs: string[]
}

export type StudioDesignVariant = {
  id: string
  packID: string
  name: string
  summary: string
  promptInstruction: string
  tokens: StudioDesignTokenMap
  componentHints: string[]
  acceptanceNotes: string[]
}

export type DesignPackContextPayload = {
  pack: StudioDesignPackMeta
  variant?: StudioDesignVariant
  matchedSkills: StudioDesignSkill[]
  rules: string[]
  tokens: string[]
  typography: string[]
  icons: string[]
  motion: string[]
  componentGuidance: string[]
  inspirationRefs: string[]
  styleNotes: string[]
}

export const BASE_DESIGN_PACK: StudioDesignPack = {
  id: "base",
  name: "Base",
  description: "Balanced Paddie defaults that respect the current app's design system and keep product UI clear.",
  tags: ["default", "accessible", "responsive"],
  tier: "base",
  sourceKinds: ["paddie"],
  preview: {
    colors: ["#0f172a", "#e2e8f0", "#38bdf8", "#22c55e"],
    note: "Neutral product foundation",
  },
  updatedAt: "built-in",
  rules: [
    "Start from the current codebase's components, tokens, spacing, and interaction patterns.",
    "Prefer clear product UI over decorative landing-page composition unless the prompt explicitly asks for marketing.",
    "Keep controls visible, named, removable, and scoped to the task the user asked for.",
    "Design for desktop and mobile breakpoints with stable dimensions for fixed-format controls.",
    "Use accessible contrast, readable type sizes, and restrained motion that communicates state.",
  ],
  tokens: {
    "surface.base": "existing app background token",
    "surface.raised": "existing raised surface token",
    "text.primary": "existing strong text token",
    "text.secondary": "existing muted text token",
    "accent.primary": "existing info/accent token",
    "border.default": "existing weaker border token",
  },
  typography: [
    "Use the current app type scale and weight names before introducing new sizes.",
    "Reserve display-size type for true page-level heroes.",
    "Keep compact controls on 11-13px label styles where the existing UI does.",
  ],
  icons: [
    "Use the existing icon library and named icon buttons where an icon is familiar.",
    "Prefer icon plus tooltip for compact tool controls.",
  ],
  motion: [
    "Use short transitions for hover, selection, loading, and panel state.",
    "Avoid decorative motion that is not tied to interaction state.",
  ],
  componentGuidance: [
    "Use existing Button, Select, Tooltip, Icon, and panel primitives when available.",
    "Cards should represent repeated items, not whole page sections.",
    "Keep attached context chips concise with a clear label, useful body, and remove affordance.",
  ],
  skills: [
    {
      id: "base-responsive-layout",
      name: "Responsive layout check",
      description: "Apply when a prompt asks for a page, app, dashboard, or tool UI.",
      trigger: "page, app, dashboard, tool, screen, responsive",
      instruction:
        "Verify desktop and mobile layout constraints, stable control dimensions, and text that does not overflow its container.",
    },
    {
      id: "base-product-density",
      name: "Product density",
      description: "Apply when the task is a SaaS, CRM, dashboard, or operational workflow.",
      trigger: "dashboard, table, workflow, crm, admin, settings, studio",
      instruction:
        "Favor dense but readable information hierarchy, restrained surfaces, and predictable navigation over large marketing blocks.",
    },
    {
      id: "base-design-context",
      name: "Design context scoping",
      description: "Apply when a design pack or variant is attached.",
      trigger: "always",
      instruction:
        "Treat design-pack guidance as explicit prompt context only for this request; preserve unrelated chat and code-builder behavior.",
    },
  ],
  inspirationRefs: ["Existing repository UI and current Paddie Studio design language."],
}

const CONTEXT_LIMIT = 18_000
const NOTE_LIMIT = 220

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")

const strings = (value: unknown) => {
  if (Array.isArray(value)) return value.flatMap((item) => (text(item) ? [text(item)] : []))
  const single = text(value)
  return single ? [single] : []
}

const compact = (value: string, limit = NOTE_LIMIT) => {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trim()}...`
}

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item"

const preview = (value: unknown): StudioDesignPackPreview => {
  const data = record(value)
  return {
    colors: strings(data.colors).slice(0, 8),
    imageUrl: text(data.imageUrl) || text(data.image_url) || undefined,
    note: text(data.note) || text(data.description) || undefined,
  }
}

const tokenEntries = (value: unknown, prefix = ""): [string, string][] => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return prefix ? [[prefix, String(value)]] : []
  }
  if (Array.isArray(value)) {
    const joined = strings(value).join(", ")
    return prefix && joined ? [[prefix, joined]] : []
  }
  return Object.entries(record(value)).flatMap(([key, next]) => tokenEntries(next, prefix ? `${prefix}.${key}` : key))
}

const normalizeTokens = (value: unknown): StudioDesignTokenMap =>
  Object.fromEntries(tokenEntries(value).map(([key, next]) => [key, compact(next, 160)]))

const normalizeSkill = (value: unknown, index: number): StudioDesignSkill | undefined => {
  const data = record(value)
  const name = text(data.name) || text(data.title)
  const instruction = text(data.instruction) || text(data.instructions) || text(data.prompt)
  if (!name && !instruction) return undefined
  return {
    id: text(data.id) || slug(name || `skill-${index + 1}`),
    name: name || `Skill ${index + 1}`,
    description: text(data.description),
    trigger: text(data.trigger) || strings(data.triggers).join(", "),
    instruction,
  }
}

export function normalizeDesignPackMeta(value: unknown): StudioDesignPackMeta {
  const data = record(value)
  return {
    id: text(data.id) || text(data.slug) || "design-pack",
    name: text(data.name) || "Untitled design pack",
    description: text(data.description),
    tags: strings(data.tags).slice(0, 12),
    tier: text(data.tier) || text(data.plan) || "free",
    sourceKinds: strings(data.sourceKinds ?? data.source_kinds ?? data.sources).slice(0, 8),
    preview: preview(data.preview),
    updatedAt: text(data.updatedAt) || text(data.updated_at),
  }
}

export function normalizeDesignPackList(value: unknown): StudioDesignPackMeta[] {
  const data = record(value)
  const items: unknown[] = Array.isArray(value) ? value : Array.isArray(data.items) ? data.items : []
  return items.map(normalizeDesignPackMeta).filter((item) => item.id.trim().length > 0)
}

export function normalizeDesignPack(value: unknown): StudioDesignPack {
  const data = record(value)
  const meta = normalizeDesignPackMeta(value)
  return {
    ...meta,
    rules: strings(data.rules).slice(0, 24),
    tokens: normalizeTokens(data.tokens),
    typography: strings(data.typography).slice(0, 16),
    icons: strings(data.icons).slice(0, 16),
    motion: strings(data.motion).slice(0, 16),
    componentGuidance: strings(data.componentGuidance ?? data.component_guidance).slice(0, 24),
    skills: (Array.isArray(data.skills) ? data.skills : []).flatMap((item, index) => {
      const skill = normalizeSkill(item, index)
      return skill ? [skill] : []
    }),
    inspirationRefs: strings(data.inspirationRefs ?? data.inspiration_refs).slice(0, 16),
  }
}

export function designPackMetaFromPack(pack: StudioDesignPack): StudioDesignPackMeta {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    tags: pack.tags,
    tier: pack.tier,
    sourceKinds: pack.sourceKinds,
    preview: pack.preview,
    updatedAt: pack.updatedAt,
  }
}

export function formatTokenEntries(tokens: StudioDesignTokenMap, limit = 12) {
  const entries = Object.entries(tokens)
  const notes = entries.slice(0, limit).map(([key, value]) => `${key}: ${value}`)
  if (entries.length > limit) notes.push(`${entries.length - limit} token${entries.length - limit === 1 ? "" : "s"} omitted`)
  return notes
}

export function matchDesignPackSkills(pack: StudioDesignPack, promptText: string) {
  const haystack = `${promptText} ${pack.name} ${pack.tags.join(" ")}`.toLowerCase()
  return pack.skills
    .filter((skill) => {
      const trigger = skill.trigger.trim().toLowerCase()
      if (!trigger || trigger === "always") return true
      return trigger
        .split(/[,|/]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .some((part) => haystack.includes(part))
    })
    .slice(0, 6)
}

export function createDesignPackVariants(pack: StudioDesignPack, promptText: string): StudioDesignVariant[] {
  const surface = /dashboard|admin|table|workflow|crm|settings/i.test(promptText)
    ? "workflow surface"
    : /landing|marketing|home|site/i.test(promptText)
      ? "site surface"
      : "interface"
  const tokens = formatTokenEntries(pack.tokens, 4).join("; ") || "reuse current app tokens"
  const componentHints = pack.componentGuidance.slice(0, 4)

  return [
    {
      id: `${pack.id}:calm-product`,
      packID: pack.id,
      name: "Calm Product",
      summary: `A restrained ${surface} direction focused on clarity, hierarchy, and native app consistency.`,
      promptInstruction:
        "Use the selected pack as a quiet product-system foundation. Keep surfaces simple, improve spacing and hierarchy, and avoid decorative composition unless explicitly requested.",
      tokens: {
        "variant.intent": "restrained product polish",
        "variant.tokens": tokens,
      },
      componentHints: [
        "Use existing app primitives before creating new controls.",
        "Prefer clear rows, panels, and toolbars with stable sizing.",
        ...componentHints.slice(0, 2),
      ],
      acceptanceNotes: [
        "The result should look native to the current app.",
        "Primary actions and removable context should be obvious.",
        "No unrelated redesign should leak into normal chat or code-builder behavior.",
      ],
    },
    {
      id: `${pack.id}:dense-utility`,
      packID: pack.id,
      name: "Dense Utility",
      summary: `A compact ${surface} direction for scanning, comparison, and repeated operational use.`,
      promptInstruction:
        "Use the selected pack to make information denser without making it cramped. Prioritize lists, controls, status, filters, and keyboard-friendly workflows.",
      tokens: {
        "variant.intent": "compact operational UI",
        "variant.spacing": "tight but readable rhythm",
        "variant.tokens": tokens,
      },
      componentHints: [
        "Use compact rows, segmented controls, selects, and icon buttons where appropriate.",
        "Keep repeated items visually comparable.",
        ...componentHints.slice(0, 2),
      ],
      acceptanceNotes: [
        "Users should be able to scan state and act repeatedly.",
        "Text must not overflow compact controls.",
        "Hover, selected, loading, and disabled states should be distinct.",
      ],
    },
    {
      id: `${pack.id}:studio-expression`,
      packID: pack.id,
      name: "Studio Expression",
      summary: `A richer ${surface} direction that adds more visual identity while staying inside the pack rules.`,
      promptInstruction:
        "Use the selected pack with a stronger visual point of view. Add one or two memorable accents, refined previews, and purposeful motion while preserving usability.",
      tokens: {
        "variant.intent": "richer Studio feel",
        "variant.accent": "one visible accent system",
        "variant.tokens": tokens,
      },
      componentHints: [
        "Use richer preview states only where they help the user choose or inspect.",
        "Keep decorative styling secondary to task completion.",
        ...componentHints.slice(0, 2),
      ],
      acceptanceNotes: [
        "The result should feel more distinctive without becoming a marketing page by default.",
        "Motion should describe state changes.",
        "Visual accents should not reduce contrast or density.",
      ],
    },
  ]
}

export function createDesignPackContextItem(
  pack: StudioDesignPack,
  variant: StudioDesignVariant | undefined,
  promptText: string,
): DesignPackContextPayload {
  const variantNotes = variant
    ? [`Variant: ${variant.name}`, variant.summary, ...variant.componentHints.slice(0, 3), ...variant.acceptanceNotes.slice(0, 3)]
    : []
  return {
    pack: designPackMetaFromPack(pack),
    variant,
    matchedSkills: matchDesignPackSkills(pack, promptText),
    rules: pack.rules.map((item) => compact(item)).slice(0, 10),
    tokens: formatTokenEntries(pack.tokens, 16),
    typography: pack.typography.map((item) => compact(item)).slice(0, 8),
    icons: pack.icons.map((item) => compact(item)).slice(0, 6),
    motion: pack.motion.map((item) => compact(item)).slice(0, 6),
    componentGuidance: pack.componentGuidance.map((item) => compact(item)).slice(0, 10),
    inspirationRefs: pack.inspirationRefs.map((item) => compact(item)).slice(0, 8),
    styleNotes: [
      ...formatTokenEntries(pack.tokens, 8),
      ...pack.typography.slice(0, 3),
      ...pack.motion.slice(0, 3),
      ...variantNotes,
    ].map((item) => compact(item)),
  }
}

export function designPackContextKey(item: DesignPackContextPayload) {
  return `design-pack:${item.pack.id}:${item.variant?.id ?? "base"}`
}

const section = (title: string, values: string[]) => {
  if (!values.length) return []
  return [title, ...values.map((value) => `- ${value}`)]
}

export function formatDesignPackContext(item: DesignPackContextPayload) {
  const variant = item.variant
  const lines = [
    "The user attached this Paddie Design Pack as explicit design context for the current request.",
    `Pack: ${item.pack.name} (${item.pack.id})`,
    item.pack.description ? `Description: ${item.pack.description}` : "",
    item.pack.tags.length ? `Tags: ${item.pack.tags.join(", ")}` : "",
    item.pack.sourceKinds.length ? `Sources: ${item.pack.sourceKinds.join(", ")}` : "",
    item.pack.tier ? `Tier: ${item.pack.tier}` : "",
    variant ? `Selected variant: ${variant.name}` : "",
    variant ? `Variant summary: ${variant.summary}` : "",
    variant ? `Variant instruction: ${variant.promptInstruction}` : "",
    ...section("Design rules:", item.rules),
    ...section("Token and style notes:", item.styleNotes),
    ...section("Component guidance:", item.componentGuidance),
    ...section(
      "Matched task-triggered skills:",
      item.matchedSkills.map((skill) =>
        compact(`${skill.name}${skill.trigger ? ` [${skill.trigger}]` : ""}: ${skill.instruction}`, 420),
      ),
    ),
    ...(variant
      ? [
          ...section("Variant tokens:", formatTokenEntries(variant.tokens, 12)),
          ...section("Variant component hints:", variant.componentHints),
          ...section("Variant acceptance notes:", variant.acceptanceNotes),
        ]
      : []),
    ...section("Inspiration references:", item.inspirationRefs),
    "Apply this pack only because it is visibly attached to prompt context. Preserve unrelated normal chat/code-builder behavior and the existing codebase conventions.",
  ].filter(Boolean)

  const output = lines.join("\n")
  if (output.length <= CONTEXT_LIMIT) return output
  return `${output.slice(0, CONTEXT_LIMIT).trim()}\n[Design pack context truncated after ${CONTEXT_LIMIT} characters.]`
}
