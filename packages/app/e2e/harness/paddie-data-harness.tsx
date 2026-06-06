import "@/index.css"
import { render } from "solid-js/web"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { Route, StaticRouter } from "@solidjs/router"
import { AuthProvider } from "@/context/auth"
import { PlatformProvider, type Platform } from "@/context/platform"
import { PromptProvider } from "@/context/prompt"
import { PaddieDataPanel } from "@/components/paddie-data-panel"

declare global {
  interface Window {
    __paddieDataHarnessLinks?: string[]
  }
}

const platform: Platform = {
  platform: "desktop",
  os: "windows",
  version: "e2e",
  openLink(url) {
    window.__paddieDataHarnessLinks = [...(window.__paddieDataHarnessLinks ?? []), url]
  },
  back() {},
  forward() {},
  async restart() {},
  async notify() {},
}

const root = document.getElementById("root")
if (!root) throw new Error("Paddie Data harness root not found")

render(
  () => (
    <PlatformProvider value={platform}>
      <AuthProvider>
        <StaticRouter url="/smoke">
          <Route
            path="/:dir"
            component={() => (
              <DialogProvider>
                <PromptProvider>
                  <main class="h-screen overflow-auto bg-background-base p-4">
                    <PaddieDataPanel />
                  </main>
                </PromptProvider>
              </DialogProvider>
            )}
          />
        </StaticRouter>
      </AuthProvider>
    </PlatformProvider>
  ),
  root,
)
