import { describe, expect, test } from "bun:test"
import {
  BASE_DESIGN_PACK,
  createDesignPackContextItem,
  createDesignPackVariants,
  designPackContextKey,
  formatDesignPackContext,
  formatTokenEntries,
  normalizeDesignPack,
  normalizeDesignPackList,
} from "./helpers"

describe("design pack helpers", () => {
  test("normalizes cloud pack metadata and detail payloads", () => {
    expect(
      normalizeDesignPackList({
        items: [
          {
            id: "studio",
            name: "Studio",
            description: "Paddie Studio design language",
            source_kinds: ["website", "user"],
            preview: { colors: ["#111111", "#eeeeee"] },
            updated_at: "2026-06-01T00:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject([
      {
        id: "studio",
        name: "Studio",
        sourceKinds: ["website", "user"],
        preview: { colors: ["#111111", "#eeeeee"] },
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ])

    const pack = normalizeDesignPack({
      id: "studio",
      name: "Studio",
      tokens: {
        color: { accent: "#38bdf8" },
        radius: { control: 8 },
      },
      component_guidance: ["Use compact context chips."],
      skills: [
        {
          name: "Dashboard density",
          trigger: "dashboard, admin",
          instruction: "Favor scan-friendly operational layouts.",
        },
      ],
    })

    expect(pack.tokens).toMatchObject({
      "color.accent": "#38bdf8",
      "radius.control": "8",
    })
    expect(pack.componentGuidance).toEqual(["Use compact context chips."])
    expect(pack.skills[0]).toMatchObject({ id: "dashboard-density", trigger: "dashboard, admin" })
  })

  test("formats exactly three compact variants for a selected pack", () => {
    const variants = createDesignPackVariants(BASE_DESIGN_PACK, "Build an admin dashboard with workflows")

    expect(variants).toHaveLength(3)
    expect(variants.map((variant) => variant.name)).toEqual(["Calm Product", "Dense Utility", "Studio Expression"])
    expect(variants.every((variant) => variant.packID === BASE_DESIGN_PACK.id)).toBe(true)
    expect(variants[0].summary).toContain("workflow surface")
    expect(formatTokenEntries(variants[0].tokens)).toContain("variant.intent: restrained product polish")
  })

  test("keys and serializes bounded explicit prompt context", () => {
    const variant = createDesignPackVariants(BASE_DESIGN_PACK, "Build a dashboard")[0]
    const item = createDesignPackContextItem(BASE_DESIGN_PACK, variant, "Build a dashboard")
    const formatted = formatDesignPackContext(item)

    expect(designPackContextKey(item)).toBe("design-pack:base:base:calm-product")
    expect(item.matchedSkills.map((skill) => skill.id)).toContain("base-responsive-layout")
    expect(formatted).toContain("Paddie Design Pack")
    expect(formatted).toContain("Selected variant: Calm Product")
    expect(formatted).toContain("Matched task-triggered skills")
    expect(formatted.length).toBeLessThan(18_500)
  })
})
