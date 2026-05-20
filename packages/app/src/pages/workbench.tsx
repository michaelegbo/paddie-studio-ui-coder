import { WorkbenchPanel } from "@/components/workbench-panel"
import { useSettings } from "@/context/settings"
import { Navigate, useParams } from "@solidjs/router"
import { Show } from "solid-js"

export default function Workbench() {
  const params = useParams()
  const settings = useSettings()
  return (
    <Show when={settings.general.betaFeatures()} fallback={<Navigate href={`/${params.dir}/session`} />}>
      <WorkbenchPanel />
    </Show>
  )
}
