import { expect, test } from "bun:test"
import { patchWorkflowBuilderScript, workflowBuilderBoot, workflowBuilderEmbedUrl } from "./workflow-builder"

test("workflow builder fallback route keeps fullscreen studio mode", () => {
  const route =
    'return R.jsx(Route,{path:"/studio/fullscreen",element:R.jsx(Gate,{children:R.jsx(Studio,{autoFullscreen:!0})})})'

  expect(patchWorkflowBuilderScript(route)).toContain(
    `${route},R.jsx(Route,{path:"*",element:R.jsx(Gate,{children:R.jsx(Studio,{autoFullscreen:!0})})})`,
  )
})

test("workflow builder router patch supports current production bundle shape", () => {
  const app =
    'function App(){return r.jsx(BrowserRouter,{children:r.jsx(ThemeProvider,{defaultTheme:"system",storageKey:"rmn-ui-theme",children:r.jsx(AuthProvider,{children:r.jsx(Routes,{})})})})}'

  expect(patchWorkflowBuilderScript(app)).toContain(
    'return r.jsx(BrowserRouter,{window:window.__paddie_router_window,children:r.jsx(ThemeProvider,{defaultTheme:"system",storageKey:"rmn-ui-theme"',
  )
})

test("workflow builder embed starts on the fullscreen route", () => {
  const boot = workflowBuilderBoot("token", {
    userId: "user",
    email: "user@example.com",
    tenantId: "tenant",
  })

  expect(boot).toContain('const loc = new URL("/studio/fullscreen", app)')
  expect(boot).toContain("background:#09090b!important")
  expect(boot).toContain("color-scheme:dark")
  expect(boot).not.toContain("/studio/embed")
})

test("workflow builder direct desktop embed uses hosted fullscreen route", () => {
  expect(workflowBuilderEmbedUrl()).toBe("https://app.paddie.io/studio/fullscreen?desktop_embed=1")
})
