import type { FastifyInstance } from "fastify";

type OwnerAdminOptions = {
  authenticate: (request: any, reply: any) => Promise<unknown>;
  supabaseAdmin: any;
  ownerEmail?: string;
};

export function registerOwnerAdminRoutes(app: FastifyInstance, options: OwnerAdminOptions) {
  const ownerEmail = (options.ownerEmail || "").trim().toLowerCase();
  const isOwner = (request: any) => Boolean(ownerEmail && request.user?.email?.trim().toLowerCase() === ownerEmail);
  const guard = async (request: any, reply: any) => {
    if (!ownerEmail) return reply.code(503).send({ error: "OWNER_NOT_CONFIGURED", message: "Owner access has not been configured." });
    if (!isOwner(request)) return reply.code(403).send({ error: "OWNER_ACCESS_DENIED", message: "This account does not have website-owner access." });
  };

  app.get("/v1/owner/access", { preHandler: options.authenticate }, async (request: any) => ({
    isOwner: isOwner(request),
  }));

  app.get("/v1/owner/overview", { preHandler: options.authenticate }, async (request: any, reply: any) => {
    const denied = await guard(request, reply);
    if (denied) return denied;
    const db = options.supabaseAdmin;
    const [userResult, jobCount, queuedCount, processingCount, completedCount, failedCount, paymentCount, recentJobs, recentPayments, subscriptions] = await Promise.all([
      db.auth.admin.listUsers({ page: 1, perPage: 50 }),
      db.from("voicebridge_jobs").select("id", { head: true, count: "exact" }),
      db.from("voicebridge_jobs").select("id", { head: true, count: "exact" }).eq("status", "queued"),
      db.from("voicebridge_jobs").select("id", { head: true, count: "exact" }).eq("status", "processing"),
      db.from("voicebridge_jobs").select("id", { head: true, count: "exact" }).eq("status", "completed"),
      db.from("voicebridge_jobs").select("id", { head: true, count: "exact" }).eq("status", "failed"),
      db.from("voicebridge_payments").select("id", { head: true, count: "exact" }),
      db.from("voicebridge_jobs").select("id,user_id,status,stage,target_language,created_at,completed_at").order("created_at", { ascending: false }).limit(20),
      db.from("voicebridge_payments").select("id,user_id,reference,payment_type,product_code,amount_minor,currency,status,created_at,paid_at").order("created_at", { ascending: false }).limit(20),
      db.from("voicebridge_subscriptions").select("id,user_id,plan_code,status,billing_interval,current_period_end,updated_at").order("updated_at", { ascending: false }).limit(20),
    ]);
    const dbErrors = [jobCount, queuedCount, processingCount, completedCount, failedCount, paymentCount, recentJobs, recentPayments, subscriptions].filter(x => x.error);
    if (userResult.error || dbErrors.length) {
      request.log.error({ authError: userResult.error?.message, databaseErrors: dbErrors.map(x => x.error?.message) }, "Owner dashboard data could not be loaded");
      return reply.code(503).send({ error: "OWNER_OVERVIEW_UNAVAILABLE", message: "Some owner dashboard data is temporarily unavailable." });
    }
    const users = (userResult.data?.users || []).map((user: any) => ({
      id: user.id,
      email: user.email || null,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
      emailConfirmed: Boolean(user.email_confirmed_at),
      bannedUntil: user.banned_until || null,
    }));
    const emailById = new Map(users.map((user: any) => [user.id, user.email]));
    const attachEmail = (rows: any[] | null) => (rows || []).map(row => ({ ...row, userEmail: emailById.get(row.user_id) || null }));
    return {
      generatedAt: new Date().toISOString(),
      ownerEmail,
      metrics: {
        accountsInLatestPage: users.length,
        totalJobs: jobCount.count || 0,
        queuedJobs: queuedCount.count || 0,
        processingJobs: processingCount.count || 0,
        completedJobs: completedCount.count || 0,
        failedJobs: failedCount.count || 0,
        totalPayments: paymentCount.count || 0,
      },
      users,
      jobs: attachEmail(recentJobs.data),
      payments: attachEmail(recentPayments.data),
      subscriptions: attachEmail(subscriptions.data),
    };
  });
}
