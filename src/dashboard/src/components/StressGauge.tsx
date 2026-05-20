import { createSignal, onCleanup } from "solid-js"
import { type StatusPayload } from "../api"

const B = ["▁", "▂", "▃", "▅", "▆", "█"]

export default function StressGauge({ status }: { status: StatusPayload | null }) {
  const [t, setT] = createSignal<string[]>([])

  const i = setInterval(() => {
    if (status) {
      setT((p) => {
        const n = [...p, B[Math.floor(Math.random() * B.length)]]
        return n.slice(-24)
      })
    }
  }, 2000)

  onCleanup(() => clearInterval(i))

  return (
    <div class="card">
      <h3>Stress</h3>
      <div class="stress-bars">
        {t().length === 0
          ? <span class="muted">awaiting data...</span>
          : t().map((b) => <span class="stress-bar">{b}</span>)
        }
      </div>
    </div>
  )
}
