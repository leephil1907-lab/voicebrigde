import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, CreditCard, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { apiRequest } from "../lib/api";
import "../owner-admin.css";

type OwnerOverview = {
  generatedAt: string;
  ownerEmail: string;
  metrics: { accountsInLatestPage: number; totalJobs: number; queuedJobs: number; processingJobs: number; completedJobs: number; failedJobs: number; totalPayments: number };
  users: { id: string; email: string | null; createdAt: string; lastSignInAt: string | null; emailConfirmed: boolean; bannedUntil: string | null }[];
  jobs: { id: string; user_id: string; userEmail: string | null; status: string; stage: string; target_language: string; created_at: string; completed_at: string | null }[];
  payments: { id: string; user_id: string; userEmail: string | null; reference: string; payment_type: string; product_code: string; amount_minor: number; currency: string; status: string; created_at: string; paid_at: string | null }[];
  subscriptions: { id: string; user_id: string; userEmail: string | null; plan_code: string; status: string; billing_interval: string | null; current_period_end: string | null; updated_at: string }[];
};

const date = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: currency || "NGN", maximumFractionDigits: 0 }).format(Number(amount || 0) / 100);

export function OwnerDashboard({ getToken }: { getToken: () => Promise<string> }) {
  const [data, setData] = useState<OwnerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await apiRequest<OwnerOverview>("/v1/owner/overview", {}, await getToken())); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load owner dashboard."); }
    finally { setLoading(false); }
  }, [getToken]);
  useEffect(() => { void refresh(); }, [refresh]);
  const m = data?.metrics;
  return <main className="content-wrap secondary-page owner-page">
    <div className="owner-heading"><div><span className="eyebrow-label">VOICEBRIDGE AI · PRIVATE CONTROL CENTER</span><h1>Owner dashboard</h1><p>Platform activity, accounts, translations and billing at a glance.</p></div><button className="button-outline" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Refresh data</button></div>
    <div className="owner-access-line"><ShieldCheck size={17}/><span>Owner access verified</span><strong>{data?.ownerEmail || "reachmarkofficial@gmail.com"}</strong><small>{data ? "Updated " + date(data.generatedAt) : "Secure owner session"}</small></div>
    {error && <div className="owner-error"><AlertTriangle size={17}/>{error}</div>}
    {loading && !data ? <section className="work-card"><p className="card-description">Loading private platform data…</p></section> : data && <>
      <div className="owner-metrics">
        <article className="owner-metric"><span><Users size={18}/></span><small>Accounts in latest page</small><strong>{m?.accountsInLatestPage ?? 0}</strong></article>
        <article className="owner-metric"><span><Activity size={18}/></span><small>Total translations</small><strong>{m?.totalJobs ?? 0}</strong></article>
        <article className="owner-metric"><span><Clock3 size={18}/></span><small>Queued / processing</small><strong>{m?.queuedJobs ?? 0} / {m?.processingJobs ?? 0}</strong></article>
        <article className="owner-metric"><span><CheckCircle2 size={18}/></span><small>Completed / failed</small><strong>{m?.completedJobs ?? 0} / {m?.failedJobs ?? 0}</strong></article>
        <article className="owner-metric"><span><CreditCard size={18}/></span><small>Payment records</small><strong>{m?.totalPayments ?? 0}</strong></article>
      </div>
      <section className="work-card owner-section"><div className="owner-section-title"><div><span className="section-kicker">CUSTOMER ACCOUNTS</span><h2>Latest registered users</h2></div><span className="owner-count">{data.users.length} shown</span></div><div className="owner-table-wrap"><table className="owner-table"><thead><tr><th>Email</th><th>Verification</th><th>Joined</th><th>Last sign-in</th><th>Access</th></tr></thead><tbody>{data.users.map(user=><tr key={user.id}><td>{user.email || "No email"}</td><td><span className={user.emailConfirmed ? "owner-status good" : "owner-status"}>{user.emailConfirmed ? "Verified" : "Unverified"}</span></td><td>{date(user.createdAt)}</td><td>{date(user.lastSignInAt)}</td><td>{user.bannedUntil ? "Restricted" : "Active"}</td></tr>)}</tbody></table></div></section>
      <section className="work-card owner-section"><div className="owner-section-title"><div><span className="section-kicker">TRANSLATION ENGINE</span><h2>Recent translation jobs</h2></div><span className="owner-count">{data.jobs.length} shown</span></div><div className="owner-table-wrap"><table className="owner-table"><thead><tr><th>Account</th><th>Target</th><th>Status</th><th>Stage</th><th>Created</th></tr></thead><tbody>{data.jobs.map(job=><tr key={job.id}><td>{job.userEmail || job.user_id.slice(0,8)}</td><td>{job.target_language.toUpperCase()}</td><td><span className={"owner-status "+(job.status==="completed"?"good":job.status==="failed"?"bad":"")}>{job.status}</span></td><td>{job.stage}</td><td>{date(job.created_at)}</td></tr>)}</tbody></table></div></section>
      <div className="owner-two-col">
        <section className="work-card owner-section"><div className="owner-section-title"><div><span className="section-kicker">PAYSTACK</span><h2>Recent payments</h2></div></div><div className="owner-table-wrap"><table className="owner-table"><thead><tr><th>Account / product</th><th>Amount</th><th>Status</th></tr></thead><tbody>{data.payments.map(payment=><tr key={payment.id}><td>{payment.userEmail || payment.product_code}<small>{payment.payment_type} · {payment.reference.slice(0,12)}…</small></td><td>{money(payment.amount_minor,payment.currency)}</td><td><span className={"owner-status "+(payment.status==="success"?"good":"")}>{payment.status}</span></td></tr>)}</tbody></table></div></section>
        <section className="work-card owner-section"><div className="owner-section-title"><div><span className="section-kicker">SUBSCRIPTIONS</span><h2>Latest plans</h2></div></div><div className="owner-table-wrap"><table className="owner-table"><thead><tr><th>Account</th><th>Plan</th><th>Status</th><th>Period ends</th></tr></thead><tbody>{data.subscriptions.map(sub=><tr key={sub.id}><td>{sub.userEmail || sub.user_id.slice(0,8)}</td><td>{sub.plan_code}</td><td>{sub.status}</td><td>{date(sub.current_period_end)}</td></tr>)}</tbody></table></div></section>
      </div>
      <p className="owner-footnote">This first owner release is read-only. Account restrictions, refunds, credit adjustments and platform-setting changes will be added with confirmation and an audit trail before they can be used.</p>
    </>}
  </main>;
}
