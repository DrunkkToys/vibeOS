const BASE=""
async function f<T>(u:string,o?:RequestInit):Promise<T>{const r=await fetch(BASE+u,{headers:{"Content-Type":"application/json"},...o});if(!r.ok)throw new Error(`API ${r.status}: ${r.statusText}`);return r.json()}
export interface StatusPayload{enabled:boolean;active_slot:string;enforce:boolean;flow_enforcer:boolean;flow_extract_todos:boolean;tdd_enforcer:boolean;tdd_strict:boolean;thinking:string;current_model:string;credit_percent:number;version:string;sessions_raw?:Record<string,unknown>}
export interface SavingsPayload{lifetime:{delegation_usd:number;cache_usd:number;missed_context7_usd:number;total_warns:number};current_session:{delegation_usd:number;cache_usd:number;warns_count:number;tool_breakdown:Record<string,number>};cache_hits_this_session:number;trend:"up"|"down"|"flat";savings_rate_per_hour:number}
export interface SessionEntry{id:string;started:string|null;cost_usd:number;delegation_savings_usd:number;cache_savings_usd:number;warns_count:number}
export interface ReportSummary{id:string;type:string;summary:string;created:string;tags:string[]}
export interface EventData{status:StatusPayload;savings:SavingsPayload}
export function fetchStatus():Promise<StatusPayload>{return f<StatusPayload>("/status")}
export function fetchSavings():Promise<SavingsPayload>{return f<SavingsPayload>("/savings")}
export function fetchSessions():Promise<{sessions:SessionEntry[];total_sessions:number}>{return f("/sessions")}
export function fetchReports():Promise<ReportSummary[]>{return f("/reports")}
export function postTrinity(action:string,slot?:string,level?:string):Promise<{ok:boolean;result?:unknown;error?:string}>{const b:Record<string,string>={action};if(slot)b.slot=slot;if(level)b.level=level;return f("/trinity",{method:"POST",body:JSON.stringify(b)})}
export function openSSE(onEvent:(d:EventData)=>void):()=>void{let closed=false;let rt:ReturnType<typeof setTimeout>|null=null;function c(){if(closed)return;const es=new EventSource(BASE+"/events");es.onmessage=e=>{try{const d=JSON.parse(e.data)as EventData;if(!closed)onEvent(d)}catch{}};es.onerror=()=>{es.close();if(!closed)rt=setTimeout(c,3000)}};c();return()=>{closed=true;if(rt)clearTimeout(rt)}}
