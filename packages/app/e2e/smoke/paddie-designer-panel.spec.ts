import { expect, test, type Page } from "@playwright/test"
import { trackPageErrors } from "../utils/errors"

test.describe("smoke: Paddie Designer panel", () => {
  test("draws the canvas and keeps frame selection interactive", async ({ page }) => {
    const errors = trackPageErrors(page)

    await page.addInitScript(() => {
      localStorage.removeItem("paddie_studio_token")
      localStorage.removeItem("paddie:designer:documents:v1")
    })
    await page.goto("/e2e/harness/paddie-designer.html", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("designer-library")).toBeVisible()
    await expect(page.getByTestId("designer-workspace")).toHaveCount(0)
    await expect(page.getByText("No designs yet")).toBeVisible()
    await page.getByTestId("designer-library").getByRole("button", { name: "Create design" }).first().click()

    await expect(page.getByTestId("designer-workspace")).toBeVisible()
    await expect(page.getByTestId("designer-selection-status")).toHaveText("No selection")
    await expectCanvasDrawn(page)

    await page.getByLabel("Design name").fill("Smoke Designer File")
    await page.getByRole("button", { name: "Save" }).click()
    await expect.poll(async () => {
      return page.evaluate(() => {
        const raw = localStorage.getItem("paddie:designer:documents:v1")
        return raw ? JSON.parse(raw).some((item: { name?: string }) => item.name === "Smoke Designer File") : false
      })
    }).toBe(true)

    await page.getByRole("button", { name: "Back" }).click()
    await expect(page.getByTestId("designer-library")).toBeVisible()
    await expect(page.getByTestId("designer-design-row").filter({ hasText: "Smoke Designer File" })).toBeVisible()
    await page.getByTestId("designer-design-row").filter({ hasText: "Smoke Designer File" }).click()
    await expect(page.getByLabel("Design name")).toHaveValue("Smoke Designer File")
    await expectCanvasDrawn(page)

    await page.getByRole("button").filter({ hasText: "Landing Hero" }).click()
    await expect(page.getByTestId("designer-selection-status")).toHaveText("1 selected")
    await page.keyboard.down("Shift")
    await page.getByRole("button").filter({ hasText: "Feature Card" }).click()
    await page.keyboard.up("Shift")
    await expect(page.getByTestId("designer-selection-status")).toHaveText("2 selected")

    await page.getByRole("button", { name: "Select" }).click()
    await expect(page.getByTestId("designer-selection-status")).toHaveText("No selection")

    await page.getByRole("button", { name: "Rect", exact: true }).click()
    await expect(page.getByTestId("designer-selection-status")).toHaveText("1 selected")
    await expectCanvasDrawn(page)

    await page.getByRole("button", { name: "Full screen" }).click()
    await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible()
    const viewport = page.viewportSize()
    const workspace = await page.getByTestId("designer-workspace").boundingBox()
    expect(workspace?.width).toBeGreaterThan((viewport?.width ?? 0) - 24)
    expect(workspace?.height).toBeGreaterThan((viewport?.height ?? 0) - 24)
    expect(errors).toEqual([])
  })
})

async function expectCanvasDrawn(page: Page) {
  await expect.poll(async () => {
    const stats = await page.getByTestId("designer-canvas-host").locator("canvas").evaluateAll((canvases) => {
      return canvases.map((canvas) => {
        const context = canvas.getContext("2d")
        if (!context) return { width: canvas.width, height: canvas.height, light: 0, accent: 0, darkSurface: 0 }
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        let light = 0
        let accent = 0
        let darkSurface = 0
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index] ?? 0
          const green = pixels[index + 1] ?? 0
          const blue = pixels[index + 2] ?? 0
          const alpha = pixels[index + 3] ?? 0
          if (alpha < 24) continue
          if (red > 210 && green > 210 && blue > 210) light += 1
          if (green > 150 && red < 80 && blue > 90 && blue < 210) accent += 1
          if (red > 12 && red < 45 && green > 12 && green < 45 && blue > 12 && blue < 55) darkSurface += 1
        }
        return { width: canvas.width, height: canvas.height, light, accent, darkSurface }
      })
    })
    return stats.some((canvas) => canvas.width >= 720 && canvas.height >= 560 && canvas.light > 250 && canvas.accent > 500 && canvas.darkSurface > 10_000)
  }).toBe(true)
}
