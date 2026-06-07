import "@/index.css"
import { render } from "solid-js/web"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { Route, StaticRouter } from "@solidjs/router"
import { AuthProvider } from "@/context/auth"
import { PlatformProvider, type Platform } from "@/context/platform"
import { PromptProvider } from "@/context/prompt"
import { DesignerPanel } from "@/components/designer-panel"

const platform: Platform = {
  platform: "desktop",
  os: "windows",
  version: "e2e",
  openLink() {},
  back() {},
  forward() {},
  async restart() {},
  async notify() {},
}

const root = document.getElementById("root")
if (!root) throw new Error("Paddie Designer harness root not found")

render(
  () => (
    <PlatformProvider value={platform}>
      <AuthProvider>
        <StaticRouter url="/designer">
          <Route
            path="/:dir"
            component={() => (
              <DialogProvider>
                <PromptProvider>
                  <main class="h-screen overflow-auto bg-background-base p-4">
                    <DesignerPanel />
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
