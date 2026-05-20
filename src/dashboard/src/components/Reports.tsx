import { createSignal, createResource } from "solid-js"
import { fetchReports, type ReportSummary } from "../api"

export default function ReportsPanel() {
  const [r] = createResource(fetchReports)
  const [sel, setSel] = createSignal<string | null>(null)
  const [rc, setRc] = createSignal<string | null>(null)

  async function openReport(id: string) {
    setSel(id)
    try {
      const res = await fetch(`/reports/${encodeURIComponent(id)}`)
      setRc(await res.text())
    } catch {
      setRc("Failed to load report")
    }
  }

  return (
    <div class="card-full">
      <h3>Reports</h3>
      {r.loading && <p class="muted">loading...</p>}
      {r.error && <p class="error">Failed to load reports</p>}
      {r() && (
        <div class="reports-layout">
          <div class="report-list">
            {(r() as ReportSummary[]).map((rt) => (
              <div
                class={`report-item ${sel() === rt.id ? "active" : ""}`}
                onClick={() => openReport(rt.id)}
              >
                <div class="report-summary">{rt.summary || rt.id}</div>
                <div class="report-meta">
                  <span class="report-type">{rt.type}</span>
                  <span class="report-date">{rt.created ? new Date(rt.created).toLocaleDateString() : ""}</span>
                </div>
              </div>
            ))}
          </div>
          <div class="report-viewer">
            {rc() ? (
              <pre class="report-content">{rc()}</pre>
            ) : (
              <p class="muted">Select a report</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
