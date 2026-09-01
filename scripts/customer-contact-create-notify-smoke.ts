/**
 * Smoke: 客源联系人登记 → 写手站内信（跳过登记人本人）
 * Run: npx tsx scripts/customer-contact-create-notify-smoke.ts
 */
import { createDb } from "../server/db";
import { createApi } from "../server/api";

async function main() {
  const db = await createDb(":memory:");
  const api = createApi(db);
  const admin = await api.auth.login("admin", "123456");
  if (!admin.ok) throw new Error("admin login failed");
  const ctx = { requestId: "customer-contact-create-notify-smoke", actorId: admin.user!.id };

  const store = await api.org.listStores(ctx, {});
  if (!store.ok || !store.data?.length) throw new Error("no store");
  const storeId = store.data[0].id;

  const agent = await api.hr.createEmployee(ctx, {
    name: "客联登记写手",
    username: `ccn_agent_${Date.now()}`,
    password: "123456",
    role: "agent",
    store_id: storeId,
  });
  if (!agent.ok || !agent.data) throw new Error(`agent: ${agent.error ?? agent.message}`);

  const peer = await api.hr.createEmployee(ctx, {
    name: "客联写手同事",
    username: `ccn_peer_${Date.now()}`,
    password: "123456",
    role: "agent",
    store_id: storeId,
  });
  if (!peer.ok || !peer.data) throw new Error(`peer: ${peer.error ?? peer.message}`);

  const customer = await api.customer.create(ctx, {
    name: "客联通知客",
    phone: `139${String(Date.now()).slice(-8)}`,
    intent: "buy",
    agent_id: peer.data.id,
    store_id: storeId,
  });
  if (!customer.ok || !customer.data) throw new Error(`customer: ${customer.error ?? customer.message}`);

  const before = await api.message.list(ctx, { userId: peer.data.id, pageSize: 100 });
  if (!before.ok) throw new Error("list before failed");
  const beforeIds = new Set((before.data ?? []).map((m) => m.id));

  const upsert = await api.customer.contacts.upsert(ctx, {
    customer_id: customer.data.id,
    name: "紧急联系人",
    relation: "配偶",
    phone: `138${String(Date.now()).slice(-8)}`,
  });
  if (!upsert.ok || !upsert.data) throw new Error(`upsert: ${upsert.error ?? upsert.message}`);

  const after = await api.message.list(ctx, { userId: peer.data.id, pageSize: 100 });
  if (!after.ok) throw new Error("list after failed");
  const created = (after.data ?? []).filter((m) => !beforeIds.has(m.id));
  const hit = created.find(
    (m) =>
      m.kind === "customer_contact" &&
      m.title.includes("客源联系人已登记") &&
      m.ref_type === "customer" &&
      m.ref_id === customer.data!.id
  );
  if (!hit) throw new Error(`expected customer_contact message, got ${JSON.stringify(created)}`);

  const selfBefore = await api.message.list(ctx, { userId: admin.user!.id, pageSize: 100 });
  const selfBeforeIds = new Set((selfBefore.data ?? []).map((m) => m.id));
  const ownCustomer = await api.customer.create(ctx, {
    name: "自登联系人客",
    phone: `137${String(Date.now()).slice(-8)}`,
    intent: "rent",
    agent_id: admin.user!.id,
    store_id: storeId,
  });
  if (!ownCustomer.ok || !ownCustomer.data) throw new Error("own customer failed");
  const selfUpsert = await api.customer.contacts.upsert(ctx, {
    customer_id: ownCustomer.data.id,
    name: "本人登记联系人",
    relation: "本人",
    phone: `136${String(Date.now()).slice(-8)}`,
  });
  if (!selfUpsert.ok) throw new Error("self upsert failed");
  const selfAfter = await api.message.list(ctx, { userId: admin.user!.id, pageSize: 100 });
  const selfCreated = (selfAfter.data ?? []).filter((m) => !selfBeforeIds.has(m.id));
  if (selfCreated.some((m) => m.kind === "customer_contact")) {
    throw new Error("actor should not receive customer_contact when writing own customer");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        asserts: 2,
        customerId: customer.data.id,
        contactId: upsert.data.id,
        messageId: hit.id,
        skippedSelfNotify: true,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
