import { createSignal, onMount, Show } from "solid-js"
import { fetchCapabilities, webSearch, type CapabilitiesPayload, type WebSearchPayload } from "../api"

export default function WebSearchPanel() {
  const [cap, setCap] = createSignal<CapabilitiesPayload | null>(null)
  const [query, setQuery] = createSignal("fetch api")
  const [provider, setProvider] = createSignal<string>("fixture")
  const [maxResults, setMaxResults] = createSignal(5)
  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)
  const [result, setResult] = createSignal<WebSearchPayload | null>(null)

  onMount(async () => {
    try {
      const d = await fetchCapabilities()
      setCap(d)
      if (d.web_search?.provider) setProvider(d.web_search.provider)
    } catch (e) {
      setErr((e as Error).message)
    }
  })

  async function runSearch() {
    setBusy(true)
    setErr(null)
    try {
      const d = await webSearch({
        query: query(),
        provider: provider(),
        max_results: maxResults(),
        compose_answer: true,
      })
      setResult(d)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const enabled = () => Boolean(cap()?.web_search?.enabled)
  const sourceLabel = () => cap()?.web_search?.fixture_mode ? "fixture" : (cap()?.web_search?.provider || provider())

  return (
    <div class="card-full">
      <h3>Web Search</h3>

      <Show when={enabled()} fallback={<p class="muted">Web search is hidden until the backend advertises support.</p>}>
        <div class="search-hero">
          <div>
            <div class="search-hero-kicker">backend-driven mode</div>
            <div class="search-hero-title">Live web retrieval with citations</div>
            <p class="search-hero-copy">
              The backend controls routing, policy, and citations. The dashboard only sends the query and renders grounded results.
            </p>
          </div>
          <div class="search-hero-meta">
            <span class="badge on">{sourceLabel()}</span>
            <span class="badge">{cap()?.web_search?.benchmark_path ? "gold set" : "live"}</span>
            <span class="badge">{maxResults()} max</span>
          </div>
        </div>

        <div class="control-group">
          <h4>Mode</h4>
          <div class="bracket-row">
            <button class={`bracket-btn ${provider() === "fixture" ? "on" : ""}`} disabled={busy()} onClick={() => setProvider("fixture")}>fixture</button>
            <button class={`bracket-btn ${provider() === "duckduckgo" ? "on" : ""}`} disabled={busy()} onClick={() => setProvider("duckduckgo")}>duckduckgo</button>
          </div>
        </div>

        <div class="control-group">
          <h4>Query</h4>
          <label class="field-label">Prompt</label>
          <textarea
            class="text-area"
            rows={3}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Ask for current docs, facts, or citations"
          />
          <label class="field-label">Results</label>
          <input
            class="text-input"
            type="number"
            min="1"
            max="10"
            value={String(maxResults())}
            onInput={(e) => setMaxResults(Math.max(1, Math.min(10, Number(e.currentTarget.value) || 5)))}
          />
          <div class="bracket-row">
            <button class="bracket-btn on" disabled={busy()} onClick={runSearch}>{busy() ? "..." : "search"}</button>
          </div>
        </div>

        <Show when={result()}>
          {(d) => (
            <div class="search-output">
              <div class="search-answer">
                <h4>Answer</h4>
                <pre class="search-answer-text">{d().answer || "No generated answer"}</pre>
                <div class="search-stats">
                  <span class="badge">results {d().meta.resultCount}</span>
                  <span class="badge">domains {d().meta.uniqueDomains}</span>
                  <span class="badge">provider {d().provider}</span>
                </div>
              </div>
              <div class="search-results">
                <h4>Results</h4>
                <div class="search-list">
                  {d().results.map((item) => (
                    <a class="search-item" href={item.url} target="_blank" rel="noreferrer">
                      <div class="search-item-title">
                        <span class="search-rank">[{item.rank}]</span> {item.title}
                      </div>
                      <div class="search-item-meta">{item.domain}</div>
                      {item.snippet && <div class="search-item-snippet">{item.snippet}</div>}
                    </a>
                  ))}
                </div>
              </div>
              <div class="search-citations">
                <h4>Citations</h4>
                <div class="citation-row">
                  {d().citations.map((c) => (
                    <a class="citation-pill" href={c.url} target="_blank" rel="noreferrer">
                      [{c.id}] {c.domain}
                    </a>
                  ))}
                </div>
                <p class="muted">provider: {d().provider} | unique domains: {d().meta.uniqueDomains}</p>
              </div>
            </div>
          )}
        </Show>
      </Show>

      {err() && <p class="error">{err()}</p>}
    </div>
  )
}
