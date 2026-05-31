import { WorkbenchPanel } from "@/components/workbench-panel"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { Navigate, useParams } from "@solidjs/router"
import { Show } from "solid-js"

export default function Workbench() {
  const params = useParams()
  const platform = usePlatform()
  const settings = useSettings()
  return (
    <Show
      when={settings.general.paddieStudioFeatures() && platform.workbench}
      fallback={<Navigate href={`/${params.dir}/session`} />}
    >
      <WorkbenchPanel />
    </Show>
  )
}
