// When the dashboard is served same-origin by the plugin's local MCP server,
// these globals are unset → BASE="" and no token (legacy behaviour). When served
// durably by the Fastify API, the page injects __VIBEOS_DASHBOARD_BASE__
// ("/api/v1/dashboard") and a per-install __VIBEOS_DASHBOARD_TOKEN__ so requests
// hit the authed durable endpoints.
const _G:any=(typeof window!=="undefined")?window:{}
const BASE:string=_G.__VIBEOS_DASHBOARD_BASE__??""
const TOKEN:string=_G.__VIBEOS_DASHBOARD_TOKEN__??""
let _backendRootBasePromise: Promise<string> | null = null
function authHeaders():Record<string,string>{const h:Record<string,string>={"Content-Type":"application/json"};if(TOKEN)h["Authorization"]="Bearer "+TOKEN;return h}
async function f<T>(u:string,o?:RequestInit):Promise<T>{const r=await fetch(BASE+u,{headers:authHeaders(),...o});if(!r.ok)throw new Error(`API ${r.status}: ${r.statusText}`);return r.json()}
function normalizeUrl(value: unknown): string { return String(value || "").trim().replace(/\/$/, "") }
function normalizeBackendRootBase(value: unknown): string { return normalizeUrl(value).replace(/\/api\/v1$/, "") }
function deriveBackendRootFromHealthUrl(value: unknown): string {
  const raw = normalizeUrl(value)
  if (!raw) return ""
  try {
    const url = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1")
    if (url.pathname.endsWith("/health")) url.pathname = url.pathname.slice(0, -"/health".length) || "/"
    return normalizeBackendRootBase(url.href)
  } catch {
    return normalizeBackendRootBase(raw.replace(/\/health$/, ""))
  }
}
async function getBackendRootBase(): Promise<string> {
  const injected = normalizeBackendRootBase(_G.__VIBEOS_BACKEND_API_BASE__)
  if (injected) return injected
  if (BASE) {
    const fromDashboardBase = normalizeUrl(BASE).replace(/\/api\/v1\/dashboard$/, "")
    if (fromDashboardBase !== normalizeUrl(BASE)) return fromDashboardBase
  }
  if (_backendRootBasePromise) return _backendRootBasePromise
  _backendRootBasePromise = (async () => {
    try {
      const status = await f<StatusPayload>("/status")
      const explicit = normalizeBackendRootBase(status.backend_api_url)
      if (explicit) return explicit
      const derived = deriveBackendRootFromHealthUrl(status.backend_health_url)
      if (derived) return derived
    } catch {}
    return "https://api.vibetheog.com"
  })()
  return _backendRootBasePromise
}
async function bf<T>(u:string,o?:RequestInit):Promise<T>{const base=await getBackendRootBase();const r=await fetch(base+u,{headers:authHeaders(),...o});if(!r.ok)throw new Error(`API ${r.status}: ${r.statusText}`);return r.json()}
export interface StatusPayload{enabled:boolean;active_slot:string;enforce:boolean;flow_enforcer:boolean;flow_extract_todos:boolean;tdd_enforcer:boolean;tdd_strict:boolean;thinking:string;current_model:string;credit_percent:number;version:string;sessions_raw?:Record<string,unknown>;backend_connected?:boolean;backendConnected?:boolean;backend_api_url?:string;backend_health_url?:string;backend_health_checked_at?:string|null;backend_health_age_ms?:number|null;backend_health_latency_ms?:number|null;backend_health_status?:number|null;backend_health_error?:string|null;model_locked?:boolean;locked_slot?:string|null;locked_model?:string|null;current_project_fingerprint?:string|null;current_project_name?:string|null;reality_check_enabled?:boolean;reality_check_scope?:string;reality_check_project_id?:string|null;reality_check_rules_count?:number}
export interface SavingsPayload{lifetime:{delegation_usd:number;cache_usd:number;missed_context7_usd:number;total_warns:number};current_session:{delegation_usd:number;cache_usd:number;warns_count:number;tool_breakdown:Record<string,number>};cache_hits_this_session:number;trend:"up"|"down"|"flat";savings_rate_per_hour:number}
export interface SessionEntry{id:string;started:string|null;cost_usd:number;delegation_savings_usd:number;cache_savings_usd:number;warns_count:number}
export interface ReportSummary{id:string;type:string;summary:string;created:string;tags:string[]}
export interface EventData{status:StatusPayload;savings:SavingsPayload}
export interface RealityCheckRule{id:string;trigger:string;pattern:string;severity:"warn"|"hint"|"flag";description?:string}
export interface RealityCheckView{scope:"global"|"project";project_id?:string|null;enabled:boolean;rules:RealityCheckRule[];global?:{enabled:boolean;rules:RealityCheckRule[]};project?:{enabled:boolean;rules:RealityCheckRule[]}|null;current_project?:{id:string;name:string;lastSeen:string;sessions:number}|null;known_projects?:{id:string;name:string;lastSeen:string;sessions:number}[]}
export interface BlackboxAnalyzePayload{project_id?:string|null;userText?:string;features?:Record<string,unknown>;action?:string;entropy?:number;uncertainty?:number;embedding?:unknown;optimizationMode?:string}
export interface CapabilityState{enabled:boolean;provider:string;fixture_mode?:boolean;benchmark_path?:string|null;backend_status?:number}
export interface CapabilitiesPayload{
  web_search:CapabilityState
  compression?:CapabilityState
  tdd?:CapabilityState
  blackbox?:CapabilityState
  vibemax?:CapabilityState
  vibeqmax?:CapabilityState
  vibeultrax?:CapabilityState
}
export interface WebSearchResult{id:string;title:string;url:string;domain:string;snippet?:string;source:string;rank:number}
export interface WebSearchPayload{ok:boolean;query:string;provider:string;results:WebSearchResult[];citations:{id:number;title:string;url:string;domain:string}[];answer:string|null;meta:{resultCount:number;uniqueDomains:number}}
export interface DashboardHomeCard{label:string;value:string}
export interface DashboardTodo{id?:string;status?:string;title?:string;text?:string;content?:string}
export interface DashboardSessionTemplate{id:string;label?:string;body?:string;signature?:string;revision?:number;source?:string}
export interface DashboardSessionLifecycle{created_at?:string|null;paused_at?:string|null;resumed_at?:string|null;archived_at?:string|null;checked_out_at?:string|null}
export interface DashboardSessionBlackbox{enabled:boolean;sub_regime:string;resolution:string;momentum:number;loop_count:number}
export interface DashboardSessionSummary{
  title:string
  session_id:string
  status:string
  locked:boolean
  archived:boolean
  project_name:string
  project_fingerprint:string|null
  started_at:string|null
  cost_usd:number
  delegation_savings_usd:number
  cache_savings_usd:number
  notes_count:number
  tags:string[]
  template:DashboardSessionTemplate
  orchestration_plan?:OrchPlan|null
  blackbox:DashboardSessionBlackbox
  recommendation:string
  notes?:{text?:string}[]
  lifecycle?:DashboardSessionLifecycle
  orchestration?:Record<string,unknown>
}
export interface DashboardHomePayload{
  home:{title:string;subtitle:string;recommendation:string;cards:DashboardHomeCard[]}
  savings:SavingsPayload
  todos:DashboardTodo[]
  current_session:DashboardSessionSummary
  template_editor:{
    enabled:boolean
    session_id:string
    template:DashboardSessionTemplate
    templates:DashboardSessionTemplate[]
    can_edit:boolean
    can_version:boolean
    version?:number
    history?:unknown[]
  }
  sessions:Array<{
    session_id:string
    is_current:boolean
    started_at:string|null
    cost_usd:number
    delegation_savings_usd:number
    cache_savings_usd:number
    status:string
    locked:boolean
    archived:boolean
    tags:string[]
    notes_count:number
    template_label:string
    template_signature:string|null
    recommendation:string
  }>
  templates:DashboardSessionTemplate[]
  session_actions:string[]
  totals:{
    total_sessions:number
    total_savings_usd:number
    current_session_savings_usd:number
    pending_todos:number
  }
  status?:StatusPayload
  blackbox?:Record<string,unknown>
  backend_connected?:boolean
  backend_status?:string
  backend_health_url?:string
  backend_version?:string|null
}
export function fetchStatus():Promise<StatusPayload>{return f<StatusPayload>("/status")}
export function fetchSavings():Promise<SavingsPayload>{return f<SavingsPayload>("/savings")}
export function fetchSessions():Promise<{sessions:SessionEntry[];total_sessions:number}>{return f("/sessions")}
export function fetchReports():Promise<ReportSummary[]>{return f("/reports")}
export function fetchCapabilities():Promise<CapabilitiesPayload>{return f<CapabilitiesPayload>("/capabilities")}
export function fetchDashboardHome():Promise<DashboardHomePayload>{return f<DashboardHomePayload>("/dashboard/home")}
export function postTrinity(action:string,slot?:string,level?:string):Promise<{ok:boolean;result?:unknown;error?:string}>{const b:Record<string,string>={action};if(slot)b.slot=slot;if(level)b.level=level;return f("/trinity",{method:"POST",body:JSON.stringify(b)})}
export function fetchRealityCheck(scope:"global"|"project"="global",project_id?:string):Promise<RealityCheckView>{const q=new URLSearchParams();q.set("scope",scope);if(project_id)q.set("project_id",project_id);return f<RealityCheckView>(`/reality-check?${q.toString()}`)}
export function saveRealityCheck(payload:{scope:"global"|"project";project_id?:string;enabled:boolean;rules:RealityCheckRule[]}):Promise<{ok:boolean;settings?:RealityCheckView;error?:string}>{return f("/reality-check",{method:"POST",body:JSON.stringify(payload)})}
export function webSearch(payload:{query:string;max_results?:number;provider?:string;compose_answer?:boolean;safe_search?:string;locale?:string}):Promise<WebSearchPayload>{return f<WebSearchPayload>("/web-search",{method:"POST",body:JSON.stringify(payload)})}
export async function checkBackendHealth(url?: string): Promise<boolean> {
  const healthUrl = url || "https://api.vibetheog.com/health"
  try {
    const r = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch { return false }
}
export function openSSE(onEvent:(d:EventData)=>void):()=>void{let closed=false;
  // Durable mode (token present): EventSource can't send an Authorization header,
  // so poll status+savings on an interval instead of using the SSE stream.
  if(TOKEN){let timer:ReturnType<typeof setInterval>|null=null;const poll=async()=>{try{const[status,savings]=await Promise.all([f<StatusPayload>("/status"),f<SavingsPayload>("/savings")]);if(!closed)onEvent({status,savings})}catch{}};poll();timer=setInterval(poll,3000);return()=>{closed=true;if(timer)clearInterval(timer)}}
  let rt:ReturnType<typeof setTimeout>|null=null;function c(){if(closed)return;const es=new EventSource(BASE+"/events");es.onmessage=e=>{try{const d=JSON.parse(e.data)as EventData;if(!closed)onEvent(d)}catch{}};es.onerror=()=>{es.close();if(!closed)rt=setTimeout(c,3000)}};c();return()=>{closed=true;if(rt)clearTimeout(rt)}}
export function blackboxAnalyze(sessionId:string,entry:BlackboxAnalyzePayload):Promise<unknown>{return bf("/api/v1/blackbox/analyze",{method:"POST",body:JSON.stringify({session_id:sessionId,project_id:entry.project_id||null,user_text:entry.userText||"",features:entry.features||{},action:entry.action||"explore",entropy:entry.entropy??1.0,uncertainty:entry.uncertainty??50,embedding:entry.embedding||null,optimization_mode:entry.optimizationMode||"auto"})})}

// ── ORCHESTRATOR ──
async function of<T>(u:string,o?:RequestInit):Promise<T>{return bf(`/api/v1/orchestrator${u}`,o)}

export interface FlowNode{id:string;tool:string;label?:string;condition?:Record<string,unknown>|null;tier?:string;x?:number;y?:number}
export interface FlowEdge{from:string;to:string}
export interface FlowGraph{nodes:FlowNode[];edges:FlowEdge[]}
export interface OrchProject{id:string;name:string;fingerprint:string|null;default_flow_id:string|null;created_at:string;updated_at:string}
export interface OrchSession{id:string;project_id:string;title:string;flow_id:string|null;created_at:string;updated_at:string}
export interface OrchFlow{id:string;scope:"global"|"project";project_id:string|null;name:string;graph:FlowGraph;created_at:string;updated_at:string}
export interface OrchStep{tool:string;label:string;reason:string;requires?:string[];nodeId?:string;tier?:string}
export interface OrchPlan{recommended_next_action:string;recommended_label:string;reason:string;confidence:number;flow?:boolean;steps:OrchStep[];signals:Record<string,unknown>;capabilities:Record<string,unknown>}
export interface OrchStepResult{step:OrchStep;result?:unknown;skipped?:boolean;reason?:string}
export interface OrchMessage{id:string;role:"user"|"assistant";content:string;plan:OrchPlan|null;results:OrchStepResult[]|null;created_at:string}

export function listProjects():Promise<{projects:OrchProject[]}>{return of("/projects")}
export function createProject(name:string,fingerprint?:string):Promise<{project:OrchProject}>{return of("/projects",{method:"POST",body:JSON.stringify({name,fingerprint})})}
export function updateProject(id:string,patch:Partial<Pick<OrchProject,"name"|"default_flow_id"|"fingerprint">>):Promise<{project:OrchProject}>{return of(`/projects/${id}`,{method:"PUT",body:JSON.stringify(patch)})}
export function deleteProject(id:string):Promise<{ok:boolean}>{return of(`/projects/${id}`,{method:"DELETE"})}

export function listSessions(projectId?:string):Promise<{sessions:OrchSession[]}>{return of(`/sessions${projectId?`?project_id=${encodeURIComponent(projectId)}`:""}`)}
export function createSession(projectId:string,title:string,flowId?:string|null):Promise<{session:OrchSession}>{return of("/sessions",{method:"POST",body:JSON.stringify({project_id:projectId,title,flow_id:flowId??null})})}
export function updateSession(id:string,patch:Partial<Pick<OrchSession,"title"|"flow_id">>):Promise<{session:OrchSession}>{return of(`/sessions/${id}`,{method:"PUT",body:JSON.stringify(patch)})}
export function deleteSession(id:string):Promise<{ok:boolean}>{return of(`/sessions/${id}`,{method:"DELETE"})}
export function listMessages(sessionId:string):Promise<{messages:OrchMessage[]}>{return of(`/sessions/${sessionId}/messages`)}

export function listFlows(projectId?:string):Promise<{flows:OrchFlow[]}>{return of(`/flows${projectId?`?project_id=${encodeURIComponent(projectId)}`:""}`)}
export function createFlow(name:string,graph:FlowGraph,scope:"global"|"project"="global",projectId?:string):Promise<{flow:OrchFlow}>{return of("/flows",{method:"POST",body:JSON.stringify({name,graph,scope,project_id:projectId})})}
export function updateFlow(id:string,patch:{name?:string;graph?:FlowGraph}):Promise<{flow:OrchFlow}>{return of(`/flows/${id}`,{method:"PUT",body:JSON.stringify(patch)})}
export function deleteFlow(id:string):Promise<{ok:boolean}>{return of(`/flows/${id}`,{method:"DELETE"})}

export interface RunHandlers{onEvent:(event:string,data:any)=>void;onError?:(err:Error)=>void;onDone?:()=>void}
// Streams a live run over SSE. EventSource can't carry an Authorization header,
// so we read the fetch body stream and parse SSE frames manually. Returns an
// abort function.
export function runSession(sessionId:string,payload:Record<string,unknown>,h:RunHandlers):()=>void{
  const ctrl=new AbortController()
  ;(async()=>{
    const base=await getBackendRootBase()
    const res=await fetch(base+`/api/v1/orchestrator/sessions/${sessionId}/run`,{method:"POST",headers:authHeaders(),body:JSON.stringify(payload),signal:ctrl.signal})
    if(!res.ok||!res.body){h.onError?.(new Error(`run failed: ${res.status}`));return}
    const reader=res.body.getReader();const dec=new TextDecoder();let buf=""
    while(true){
      const{done,value}=await reader.read();if(done)break
      buf+=dec.decode(value,{stream:true})
      let idx:number
      while((idx=buf.indexOf("\n\n"))>=0){
        const block=buf.slice(0,idx);buf=buf.slice(idx+2)
        const ev=block.match(/event: (.*)/)?.[1]
        const dataLine=block.slice(block.indexOf("data: ")+6)
        if(!ev||block.indexOf("data: ")<0)continue
        try{h.onEvent(ev,JSON.parse(dataLine))}catch{}
      }
    }
    h.onDone?.()
  })().catch((e)=>{if(e?.name!=="AbortError")h.onError?.(e)})
  return()=>ctrl.abort()
}
