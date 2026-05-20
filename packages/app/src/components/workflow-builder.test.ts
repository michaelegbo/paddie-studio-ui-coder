import { expect, test } from "bun:test"
import { patchWorkflowBuilderScript, workflowBuilderBoot } from "./workflow-builder"

test("workflow builder fallback route keeps fullscreen studio mode", () => {
  const route =
    'return R.jsx(Route,{path:"/studio/fullscreen",element:R.jsx(Gate,{children:R.jsx(Studio,{autoFullscreen:!0})})})'

  expect(patchWorkflowBuilderScript(route)).toContain(
    `${route},R.jsx(Route,{path:"*",element:R.jsx(Gate,{children:R.jsx(Studio,{autoFullscreen:!0})})})`,
  )
})

test("workflow builder embed starts on the fullscreen route", () => {
  const boot = workflowBuilderBoot("token", {
    userId: "user",
    email: "user@example.com",
    tenantId: "tenant",
  })

  expect(boot).toContain('const loc = new URL("/studio/fullscreen", app)')
  expect(boot).not.toContain("/studio/embed")
})
