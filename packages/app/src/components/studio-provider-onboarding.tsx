import { Button } from "@opencode-ai/ui/button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"

const STORAGE_KEY = "paddie_studio_provider_onboarding_seen_v1"

type OnboardingStorage = Pick<Storage, "getItem" | "setItem">

export function studioProviderOnboardingSeen(storage: OnboardingStorage | undefined = globalThis.localStorage) {
  try {
    return storage?.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function markStudioProviderOnboardingSeen(storage: OnboardingStorage | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, "1")
  } catch {
    // Storage can be unavailable in restricted browser contexts. The prompt should still be dismissible.
  }
}

export function shouldShowStudioProviderOnboarding(input: {
  providerCatalogReady: boolean
  connectedProviderCount: number
  seen: boolean
}) {
  if (!input.providerCatalogReady) return false
  if (input.connectedProviderCount > 0) return false
  return !input.seen
}

export function StudioProviderOnboarding(props: {
  onChooseProvider: () => void
  onConnectOpenAI: () => void
  onDismiss: () => void
}) {
  return (
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div class="w-full max-w-[560px] overflow-hidden rounded-[20px] border border-border-weaker-base bg-surface-base shadow-[var(--shadow-lg-border-base)]">
        <div class="border-b border-border-weaker-base bg-background-base/70 px-5 py-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 items-center gap-3">
              <div class="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border-weaker-base bg-background-stronger shadow-xs-border">
                <ProviderIcon id="openai" class="size-6 icon-strong-base" />
              </div>
              <div class="min-w-0">
                <div class="text-10-medium uppercase tracking-[0.12em] text-text-weak">Model setup</div>
                <div class="mt-1 text-18-medium text-text-strong">Connect a provider to start building</div>
              </div>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
              onClick={props.onDismiss}
            >
              Close
            </button>
          </div>
        </div>

        <div class="px-5 py-5">
          <p class="m-0 text-14-regular leading-6 text-text-base">
            Paddie Studio uses the provider you connect for chat, templates, Autopilot, workflows, and code generation.
            We recommend OpenAI for the first setup. You can use your ChatGPT account where OpenAI sign-in is available,
            or connect with an API key.
          </p>

          <div class="mt-5 grid gap-3 sm:grid-cols-2">
            <div class="rounded-2xl border border-border-weaker-base bg-background-stronger p-4">
              <div class="text-13-medium text-text-strong">Recommended first</div>
              <div class="mt-1 text-12-regular text-text-weak">
                Connect OpenAI and choose GPT models from the normal model picker.
              </div>
            </div>
            <div class="rounded-2xl border border-border-weaker-base bg-background-stronger p-4">
              <div class="text-13-medium text-text-strong">Still flexible</div>
              <div class="mt-1 text-12-regular text-text-weak">
                You can choose Anthropic, Gemini, OpenRouter, Copilot, or a custom provider instead.
              </div>
            </div>
          </div>

          <div class="mt-6 flex flex-wrap items-center gap-3">
            <Button class="h-10 px-4 text-13-medium" onClick={props.onConnectOpenAI}>
              Connect OpenAI
            </Button>
            <Button variant="secondary" class="h-10 px-4 text-13-medium" onClick={props.onChooseProvider}>
              Choose another provider
            </Button>
            <Button variant="ghost" class="h-10 px-3 text-13-medium text-text-weak" onClick={props.onDismiss}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
