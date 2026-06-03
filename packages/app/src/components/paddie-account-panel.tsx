import { Button } from "@opencode-ai/ui/button"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useAuth } from "@/context/auth"
import { usePlatform } from "@/context/platform"
import { paddieApi, paddieApiErrorMessage } from "@/lib/paddie-api"
import { STUDIO_AUTH_REDIRECT } from "@/lib/paddie-links"

type BillingPeriod = "monthly" | "yearly"

type AccountSubscription = {
  has_subscription?: boolean
  plan_slug?: string | null
  plan_name?: string | null
  status?: string | null
  billing_period?: BillingPeriod | null
  trial_ends_at?: string | null
  trial_days_remaining?: number | null
}

type AccountPlan = {
  _id?: string
  id?: string
  name: string
  slug: string
  description?: string
  features?: string[]
  price_monthly: number
  price_yearly: number
  checkout_mode?: "free" | "stripe" | "trial" | "manual"
  is_current?: boolean
  stripe_available?: boolean
  billing_periods?: {
    monthly?: boolean
    yearly?: boolean
  }
}

type AccountDashboard = {
  subscription?: AccountSubscription
  billing?: {
    next_invoice_at?: string | null
    cancel_at?: string | null
    portal_available?: boolean
  }
  plans?: AccountPlan[]
  pending_request?: {
    requested_plan_slug?: string
    requested_plan_name?: string
    requested_billing_period?: BillingPeriod | null
    status?: string
    requested_at?: string | number | null
  } | null
  analytics?: {
    period?: string
    warnings?: string[]
    totals?: Record<string, number | string | null | undefined>
    usage?: Array<{
      key?: string
      label?: string
      current?: number | null
      limit?: number | null
      unit?: string | null
      reset_at?: string | number | null
    }>
    activity?: Array<{
      id?: string
      type?: string
      label?: string
      value?: string | number | null
      created_at?: string | number | null
    }>
  }
}

const DASHBOARD_ENDPOINT = "/studio/account/dashboard"
const totalLabels: Record<string, string> = {
  workflow_runs: "Workflow runs",
  studio_flows: "Studio flows",
  templates_used: "Templates used",
  studio_events: "Studio events",
  failed_events: "Failed events",
  memory_requests: "Memory requests",
  knowledge_queries: "Knowledge queries",
  api_requests: "API requests",
  autopilot_runs: "Autopilot runs",
  storage_bytes: "Storage",
}

export function PaddieAccountPanel() {
  const auth = useAuth()
  const platform = usePlatform()
  const [dashboard, setDashboard] = createSignal<AccountDashboard>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<unknown>()
  const [billingPeriod, setBillingPeriod] = createSignal<BillingPeriod>("monthly")
  const [actionError, setActionError] = createSignal<string>()
  const [actionMessage, setActionMessage] = createSignal<string>()
  const [busyAction, setBusyAction] = createSignal<string>()
  let loadedUserID = ""

  const subscription = createMemo(() => ({
    plan_slug: auth.subscription()?.plan_slug ?? "trial",
    status: auth.subscription()?.status ?? "subscription_required",
    trial_ends_at: auth.subscription()?.trial_ends_at,
    trial_days_remaining: auth.subscription()?.trial_days_remaining,
    ...dashboard()?.subscription,
  }))
  const plans = createMemo(() => dashboard()?.plans ?? [])
  const totals = createMemo(() =>
    Object.entries(dashboard()?.analytics?.totals ?? {})
      .filter((entry): entry is [string, number | string] => entry[1] !== undefined && entry[1] !== null)
      .map(([key, value]) => ({
        key,
        label: totalLabels[key] ?? labelFromKey(key),
        value: formatMetricValue(key, value),
      })),
  )
  const usage = createMemo(() => dashboard()?.analytics?.usage ?? [])
  const activity = createMemo(() => dashboard()?.analytics?.activity ?? [])

  const loadDashboard = async () => {
    setLoading(true)
    setError(undefined)
    setActionError(undefined)
    try {
      setDashboard(await paddieApi.get<AccountDashboard>(DASHBOARD_ENDPOINT))
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  const selectPlan = async (plan: AccountPlan) => {
    setActionError(undefined)
    setActionMessage(undefined)
    if (plan.is_current) return
    if (plan.checkout_mode === "manual") {
      setActionMessage("Manual plans need approval from Paddie support. The current RMN API exposes them here but does not approve them automatically.")
      return
    }
    if (plan.checkout_mode !== "stripe") {
      setActionError("This plan is not available for checkout.")
      return
    }
    if (!plan.stripe_available) {
      setActionError("Stripe checkout is not configured for this plan.")
      return
    }
    const planId = plan.id ?? plan._id
    if (!planId) {
      setActionError("RMN did not return a plan ID for this plan.")
      return
    }

    const actionID = `checkout:${plan.slug}`
    setBusyAction(actionID)
    try {
      const result = await paddieApi.post<{ checkout_url?: string }>("/studio/account/checkout", {
        planId,
        billingPeriod: billingPeriod(),
        redirect: STUDIO_AUTH_REDIRECT,
      })
      if (!result.checkout_url) throw new Error("RMN did not return a checkout URL")
      platform.openLink(result.checkout_url)
      setActionMessage("Checkout opened. Studio will refresh when RMN confirms the subscription.")
    } catch (err) {
      setActionError(paddieApiErrorMessage(err))
    } finally {
      setBusyAction(undefined)
    }
  }

  const openBillingPortal = async () => {
    setActionError(undefined)
    setActionMessage(undefined)
    setBusyAction("portal")
    try {
      const result = await paddieApi.post<{ portal_url?: string }>("/studio/account/portal", {
        redirect: STUDIO_AUTH_REDIRECT,
      })
      if (!result.portal_url) throw new Error("RMN did not return a billing portal URL")
      platform.openLink(result.portal_url)
      setActionMessage("Billing portal opened for payment method and invoice changes.")
    } catch (err) {
      setActionError(paddieApiErrorMessage(err))
    } finally {
      setBusyAction(undefined)
    }
  }

  createEffect(() => {
    const userID = auth.user()?.userId
    if (!auth.isAuthenticated() || !userID) return
    if (loadedUserID === userID) return
    loadedUserID = userID
    void loadDashboard()
  })

  return (
    <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section class="rounded-lg border border-border-weaker-base bg-surface-base p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-14-medium text-text-base">Plan</div>
            <div class="mt-1 text-12-medium text-text-weak">{auth.user()?.email ?? "Signed in"}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button class="h-8 px-3 text-11-medium" onClick={() => setActionMessage("Choose a plan below.")}>
              Manage plan
            </Button>
            <Button
              variant="ghost"
              class="h-8 px-3 text-11-medium"
              disabled={!dashboard()?.billing?.portal_available || busyAction() === "portal"}
              onClick={openBillingPortal}
            >
              Payment details
            </Button>
            <Button variant="ghost" class="h-8 px-3 text-11-medium" disabled={loading()} onClick={() => void loadDashboard()}>
              Refresh
            </Button>
          </div>
        </div>

        <div class="mt-4 grid gap-2 md:grid-cols-3">
          <PlanField label="Current plan" value={subscription().plan_name ?? subscription().plan_slug ?? "unknown"} />
          <PlanField label="Status" value={statusText(subscription().status ?? undefined)} />
          <PlanField
            label="Trial"
            value={
              typeof subscription().trial_days_remaining === "number"
                ? `${subscription().trial_days_remaining} days left`
                : subscription().trial_ends_at
                  ? `Ends ${dateText(subscription().trial_ends_at)}`
                  : "Not active"
            }
          />
        </div>

        <Show when={dashboard()?.billing?.next_invoice_at || dashboard()?.billing?.cancel_at}>
          <div class="mt-3 divide-y divide-border-weaker-base overflow-hidden rounded-lg border border-border-weaker-base">
            <Show when={dashboard()?.billing?.next_invoice_at}>
              <BillingRow label="Next invoice" value={dateText(dashboard()?.billing?.next_invoice_at)} />
            </Show>
            <Show when={dashboard()?.billing?.cancel_at}>
              <BillingRow label="Cancellation" value={dateText(dashboard()?.billing?.cancel_at)} />
            </Show>
          </div>
        </Show>

        <Show when={error()}>
          <div class="mt-3 rounded-lg border border-border-weaker-base bg-background-stronger p-3">
            <div class="text-12-medium text-text-base">Could not load account data from Paddie.</div>
            <div class="mt-1 text-11-medium text-text-weak">{paddieApiErrorMessage(error())}</div>
            <Button variant="ghost" class="mt-3 h-8 px-3 text-11-medium" onClick={() => void loadDashboard()}>
              Retry
            </Button>
          </div>
        </Show>

        <Show when={actionError() || actionMessage()}>
          <div class="mt-3 rounded-lg border border-border-weaker-base bg-background-stronger p-3 text-12-medium text-text-weak">
            {actionError() ?? actionMessage()}
          </div>
        </Show>
      </section>

      <section class="rounded-lg border border-border-weaker-base bg-surface-base p-4">
        <div class="text-14-medium text-text-base">Analytics</div>
        <div class="mt-1 text-12-medium text-text-weak">{dashboard()?.analytics?.period ?? "Current period"}</div>

        <Show
          when={!loading()}
          fallback={<div class="mt-4 rounded-lg border border-border-weaker-base bg-background-stronger p-3 text-12-medium text-text-weak">Loading analytics...</div>}
        >
          <Show
            when={totals().length || usage().length || activity().length}
            fallback={<div class="mt-4 rounded-lg border border-border-weaker-base bg-background-stronger p-3 text-12-medium text-text-weak">No analytics returned yet.</div>}
          >
            <Show when={totals().length}>
              <div class="mt-4 grid gap-2 sm:grid-cols-2">
                <For each={totals()}>{(item) => <PlanField label={item.label} value={item.value} />}</For>
              </div>
            </Show>
            <Show when={dashboard()?.analytics?.warnings?.length}>
              <div class="mt-3 text-11-medium text-text-weak">Some analytics counters are temporarily unavailable.</div>
            </Show>
          </Show>
        </Show>
      </section>

      <section class="rounded-lg border border-border-weaker-base bg-surface-base p-4 xl:col-span-2">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-14-medium text-text-base">Plans</div>
            <div class="mt-1 text-12-medium text-text-weak">Choose monthly or yearly billing, then select a plan.</div>
          </div>
          <div class="flex overflow-hidden rounded-lg border border-border-weaker-base">
            <button
              class={`h-8 px-3 text-11-medium ${billingPeriod() === "monthly" ? "bg-background-stronger text-text-base" : "text-text-weak"}`}
              onClick={() => setBillingPeriod("monthly")}
            >
              Monthly
            </button>
            <button
              class={`h-8 border-l border-border-weaker-base px-3 text-11-medium ${billingPeriod() === "yearly" ? "bg-background-stronger text-text-base" : "text-text-weak"}`}
              onClick={() => setBillingPeriod("yearly")}
            >
              Yearly
            </button>
          </div>
        </div>

        <Show
          when={plans().length}
          fallback={<div class="mt-4 rounded-lg border border-border-weaker-base bg-background-stronger p-3 text-12-medium text-text-weak">No plans returned from RMN yet.</div>}
        >
          <div class="mt-4 overflow-hidden rounded-lg border border-border-weaker-base">
            <For each={plans()}>
              {(plan) => (
                <div class="flex flex-col gap-3 border-b border-border-weaker-base bg-background-stronger p-3 last:border-b-0 md:flex-row md:items-center md:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="text-13-medium text-text-base">{plan.name}</div>
                      <Show when={plan.is_current}>
                        <span class="text-11-medium text-text-weak">Current</span>
                      </Show>
                      <Show when={dashboard()?.pending_request?.requested_plan_slug === plan.slug}>
                        <span class="text-11-medium text-text-weak">Request pending</span>
                      </Show>
                    </div>
                    <div class="mt-1 text-12-medium text-text-weak">{plan.description ?? plan.features?.slice(0, 2).join(" · ") ?? "Paddie plan"}</div>
                  </div>
                  <div class="flex shrink-0 items-center gap-3">
                    <div class="min-w-[88px] text-right text-12-medium text-text-base">{planPrice(plan, billingPeriod())}</div>
                    <Button
                      class="h-8 min-w-[112px] px-3 text-11-medium"
                      variant={plan.is_current ? "ghost" : "primary"}
                      disabled={
                        plan.is_current ||
                        busyAction() === `checkout:${plan.slug}` ||
                        plan.checkout_mode === "free" ||
                        !planSupportsPeriod(plan, billingPeriod())
                      }
                      onClick={() => void selectPlan(plan)}
                    >
                      {planButtonText(plan, billingPeriod())}
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      <Show when={usage().length}>
        <section class="rounded-lg border border-border-weaker-base bg-surface-base p-4 xl:col-span-2">
          <div class="text-14-medium text-text-base">Usage</div>
          <div class="mt-3 overflow-hidden rounded-lg border border-border-weaker-base">
            <For each={usage()}>
              {(item) => (
                <BillingRow
                  label={item.label ?? labelFromKey(item.key ?? "usage")}
                  value={usageText(item.current, item.limit, item.unit)}
                  detail={item.reset_at ? `Resets ${dateText(item.reset_at)}` : undefined}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={activity().length}>
        <section class="rounded-lg border border-border-weaker-base bg-surface-base p-4 xl:col-span-2">
          <div class="text-14-medium text-text-base">Recent activity</div>
          <div class="mt-3 overflow-hidden rounded-lg border border-border-weaker-base">
            <For each={activity().slice(0, 12)}>
              {(item) => (
                <BillingRow
                  label={item.label ?? labelFromKey(item.type ?? "activity")}
                  value={item.value == null ? "" : String(item.value)}
                  detail={item.created_at ? dateText(item.created_at) : undefined}
                />
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  )
}

function PlanField(props: { label: string; value: string }) {
  return (
    <div class="rounded-lg border border-border-weaker-base bg-background-stronger p-3">
      <div class="text-11-medium text-text-weak">{props.label}</div>
      <div class="mt-1 truncate text-14-medium text-text-base">{props.value}</div>
    </div>
  )
}

function BillingRow(props: { label: string; value?: string; detail?: string }) {
  return (
    <div class="flex items-center justify-between gap-3 bg-background-stronger px-3 py-2.5">
      <div class="min-w-0">
        <div class="truncate text-12-medium text-text-base">{props.label}</div>
        <Show when={props.detail}>
          {(detail) => <div class="mt-0.5 truncate text-11-medium text-text-weak">{detail()}</div>}
        </Show>
      </div>
      <div class="shrink-0 text-12-medium text-text-weak">{props.value}</div>
    </div>
  )
}

function labelFromKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function statusText(value: string | undefined) {
  if (!value) return "unknown"
  return labelFromKey(value)
}

function formatMetricValue(key: string, value: number | string) {
  if (typeof value === "string") return value
  if (key.endsWith("_bytes")) return bytes(value)
  return new Intl.NumberFormat().format(value)
}

function usageText(current: number | null | undefined, limit: number | null | undefined, unit: string | null | undefined) {
  const suffix = unit ? ` ${unit}` : ""
  if (typeof current !== "number") return limit == null ? "-" : `${new Intl.NumberFormat().format(limit)}${suffix}`
  if (typeof limit !== "number") return `${new Intl.NumberFormat().format(current)}${suffix}`
  return `${new Intl.NumberFormat().format(current)} / ${new Intl.NumberFormat().format(limit)}${suffix}`
}

function planPrice(plan: AccountPlan, period: BillingPeriod) {
  const price = period === "yearly" ? plan.price_yearly : plan.price_monthly
  if (price === -1 || plan.checkout_mode === "manual") return "Custom"
  if (price === 0) return "Included"
  const suffix = period === "yearly" ? "/yr" : "/mo"
  return `${new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(price / 100)}${suffix}`
}

function planSupportsPeriod(plan: AccountPlan, period: BillingPeriod) {
  if (plan.checkout_mode !== "stripe") return true
  return Boolean(plan.billing_periods?.[period])
}

function planButtonText(plan: AccountPlan, period: BillingPeriod) {
  if (plan.is_current) return "Current"
  if (plan.checkout_mode === "manual") return "Request"
  if (plan.checkout_mode === "free") return "Unavailable"
  if (!plan.stripe_available) return "Unavailable"
  if (!planSupportsPeriod(plan, period)) return "Unavailable"
  return "Select"
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

function dateText(value: string | number | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}
