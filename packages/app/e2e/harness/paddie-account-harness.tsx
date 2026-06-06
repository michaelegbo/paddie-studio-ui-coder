import "@/index.css"
import { render } from "solid-js/web"
import { Route, StaticRouter } from "@solidjs/router"
import { AuthProvider, TOKEN_KEY } from "@/context/auth"
import { PlatformProvider, type Platform } from "@/context/platform"
import { PaddieAccountPanel } from "@/components/paddie-account-panel"

declare global {
  interface Window {
    __paddieAccountHarnessLinks?: string[]
    __paddie_fetch?: typeof fetch
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

window.__paddie_fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
  if (url.pathname === "/api/auth/me") {
    return json({
      success: true,
      data: {
        id: "usr_harness",
        email: "studio@example.com",
        tenant_id: "tenant_harness",
      },
    })
  }
  if (url.pathname === "/api/users/me/subscription") {
    return json({
      success: true,
      data: {
        plan: { slug: "pro" },
        subscription: { status: "trialing" },
        access_allowed: true,
        trial_days_remaining: 12,
        trial_ends_at: "2026-06-14T00:00:00.000Z",
      },
    })
  }
  if (url.pathname === "/api/studio/account/dashboard") {
    return json({
      success: true,
      data: {
        subscription: {
          plan_slug: "pro",
          plan_name: "Pro",
          status: "trialing",
          trial_days_remaining: 12,
        },
        billing: {
          next_invoice_at: "2026-06-14T00:00:00.000Z",
          portal_available: true,
        },
        plans: [
          {
            _id: "plan_starter",
            id: "plan_starter",
            name: "Starter",
            slug: "starter",
            description: "For solo builders shipping a real product",
            features: ["50,000 API calls / month", "Unlimited Studio flows"],
            price_monthly: 2000,
            price_yearly: 20000,
            checkout_mode: "stripe",
            stripe_available: true,
            is_current: false,
            billing_periods: { monthly: true, yearly: true },
          },
          {
            _id: "plan_pro",
            id: "plan_pro",
            name: "Pro",
            slug: "pro",
            description: "Current Studio plan",
            features: ["Advanced analytics", "Priority support"],
            price_monthly: 9900,
            price_yearly: 99000,
            checkout_mode: "stripe",
            stripe_available: true,
            is_current: true,
            billing_periods: { monthly: true, yearly: true },
          },
          {
            _id: "plan_enterprise",
            id: "plan_enterprise",
            name: "Enterprise",
            slug: "enterprise",
            description: "On-prem, SSO, audit logs, custom SLA",
            features: ["Unlimited everything", "Dedicated support"],
            price_monthly: -1,
            price_yearly: -1,
            checkout_mode: "manual",
            stripe_available: true,
            is_current: false,
            billing_periods: { monthly: false, yearly: false },
          },
        ],
        analytics: {
          period: "Last 30 days",
          totals: {
            workflow_runs: 18,
            studio_flows: 9,
            templates_used: 7,
            studio_events: 24,
            memory_requests: 42,
            knowledge_queries: 13,
            api_requests: 84,
          },
          usage: [
            { key: "studio_flows", label: "Studio flows", current: 18, limit: 100, unit: "runs", reset_at: "2026-07-01T00:00:00.000Z" },
            { key: "api_requests", label: "API requests", current: 84, limit: 1000, unit: "calls" },
          ],
          activity: [
            { id: "act_1", type: "template", label: "Template opened", value: "CRM Dashboard", created_at: "2026-06-01T12:00:00.000Z" },
            { id: "act_2", type: "workflow", label: "Workflow run", value: "Lead enrichment", created_at: "2026-06-01T13:00:00.000Z" },
          ],
        },
      },
    })
  }
  if (url.pathname === "/api/studio/account/checkout") {
    return json({
      success: true,
      data: {
        checkout_url: "https://checkout.stripe.test/session",
        session_id: "cs_test_harness",
        plan_slug: "starter",
        trial_days: 14,
      },
    })
  }
  if (url.pathname === "/api/studio/account/portal") {
    return json({
      success: true,
      data: {
        portal_url: "https://billing.stripe.test/session",
      },
    })
  }
  if (url.pathname === "/api/studio/events") return json({ success: true })
  return json({ success: false, error: `Unhandled ${url.pathname}` }, 404)
}

localStorage.setItem(TOKEN_KEY, "harness-token")

const platform: Platform = {
  platform: "desktop",
  os: "windows",
  version: "e2e",
  openLink(url) {
    window.__paddieAccountHarnessLinks = [...(window.__paddieAccountHarnessLinks ?? []), url]
  },
  back() {},
  forward() {},
  async restart() {},
  async notify() {},
}

const root = document.getElementById("root")
if (!root) throw new Error("Paddie Account harness root not found")

render(
  () => (
    <PlatformProvider value={platform}>
      <AuthProvider>
        <StaticRouter url="/smoke">
          <Route
            path="/:dir"
            component={() => (
              <main class="h-screen overflow-auto bg-background-base p-4">
                <PaddieAccountPanel />
              </main>
            )}
          />
        </StaticRouter>
      </AuthProvider>
    </PlatformProvider>
  ),
  root,
)
