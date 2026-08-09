import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

export type MessageChannel = {
  key: string;
  label: string;
  description: string;
  kinds: string[];
  locked?: boolean;
};

export const MESSAGE_CHANNELS: MessageChannel[] = [
  {
    key: "deal",
    label: "成交审批",
    description: "成交提交、审批通过与驳回（不可关闭）",
    kinds: ["deal_submit", "deal_approve", "deal_reject"],
    locked: true,
  },
  {
    key: "payment",
    label: "收付款",
    description: "佣金到账、收款驳回、意向金冲抵与退款",
    kinds: ["payment", "payment_reject", "earnest_apply", "earnest_refund"],
  },
  {
    key: "follow",
    label: "跟进与带看",
    description: "待跟进提醒、非接盘人带看提醒",
    kinds: ["follow_due", "view_non_holder"],
  },
  {
    key: "house",
    label: "房源协作",
    description: "角色人、合作盘、钥匙、验真、委托、过户、按揭",
    kinds: [
      "house_role",
      "house_agent",
      "house_cooperation",
      "key_borrow",
      "verification_pending",
      "verification_review",
      "entrustment_terminated",
      "transfer_node",
      "mortgage_status",
    ],
  },
  {
    key: "customer",
    label: "客源提醒",
    description: "私客掉公、公客认领相关提醒",
    kinds: ["customer_public_pool", "customer_claim"],
  },
  {
    key: "office",
    label: "办公协同",
    description: "公告、会签、工牌、工作总结",
    kinds: ["office_announcement", "office_workflow", "office_ticket", "office_work_summary"],
  },
  {
    key: "rental",
    label: "租赁托管",
    description: "租约、收租与维修保洁",
    kinds: ["rental"],
  },
  {
    key: "care",
    label: "客户关怀",
    description: "投诉、诉讼、调查与回访",
    kinds: ["customer_care"],
  },
  {
    key: "marketing",
    label: "营销线索",
    description: "线索分派与营销活动",
    kinds: ["marketing"],
  },
  {
    key: "performance",
    label: "积分绩效",
    description: "积分、目标、管理奖与分红",
    kinds: ["performance"],
  },
  {
    key: "hr",
    label: "人事财务流程",
    description: "考勤请假、报销、招聘、合同、薪酬、调动与离职",
    kinds: [
      "leave_pending",
      "leave_review",
      "expense_pending",
      "expense_review",
      "expense_paid",
      "recruitment",
      "employee_contract",
      "payroll",
      "employee_transfer",
      "offboarding",
    ],
  },
  {
    key: "newhome",
    label: "新房业务",
    description: "报备与销售报告",
    kinds: ["newhome_registration", "newhome_sales_report"],
  },
  {
    key: "deal_ext",
    label: "成交纠纷更名",
    description: "成交投诉与更名申请",
    kinds: ["deal_complaint", "deal_rename"],
  },
  {
    key: "other",
    label: "其他业务",
    description: "未归类业务提醒",
    kinds: ["business_record_status"],
  },
];

const KIND_TO_CHANNEL = new Map<string, MessageChannel>();
for (const channel of MESSAGE_CHANNELS) {
  for (const kind of channel.kinds) KIND_TO_CHANNEL.set(kind, channel);
}

function channelForKind(kind: string): MessageChannel | undefined {
  return KIND_TO_CHANNEL.get(kind);
}

function isChannelEnabled(db: Db, userId: string, channelKey: string): boolean {
  const channel = MESSAGE_CHANNELS.find((item) => item.key === channelKey);
  if (channel?.locked) return true;
  const row = db
    .prepare(
      `SELECT enabled FROM message_subscriptions WHERE user_id = ? AND channel = ?`
    )
    .get(userId, channelKey) as { enabled?: number } | undefined;
  if (!row) return true;
  return Number(row.enabled) === 1;
}

export function createMessage(
  db: Db,
  input: {
    company_id: string;
    store_id?: string | null;
    user_id: string;
    title: string;
    body: string;
    kind: string;
    ref_type?: string;
    ref_id?: string;
  }
): boolean {
  const channel = channelForKind(input.kind);
  if (channel && !isChannelEnabled(db, input.user_id, channel.key)) {
    return false;
  }
  db.prepare(
    `INSERT INTO messages(id, company_id, store_id, user_id, title, body, kind, ref_type, ref_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    nextId("MSG"),
    input.company_id,
    input.store_id || null,
    input.user_id,
    input.title,
    input.body,
    input.kind,
    input.ref_type || null,
    input.ref_id || null,
    nowIso()
  );
  return true;
}

export function listMessages(db: Db, user: SessionUser) {
  return db
    .prepare(
      `SELECT * FROM messages WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .all(user.company_id, user.id);
}

export function unreadCount(db: Db, user: SessionUser): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages WHERE company_id = ? AND user_id = ? AND is_read = 0`
    )
    .get(user.company_id, user.id) as { c: number };
  return row.c;
}

export function markRead(db: Db, user: SessionUser, id?: string) {
  if (id) {
    db.prepare(
      `UPDATE messages SET is_read = 1 WHERE id = ? AND user_id = ? AND company_id = ?`
    ).run(id, user.id, user.company_id);
  } else {
    db.prepare(
      `UPDATE messages SET is_read = 1 WHERE user_id = ? AND company_id = ?`
    ).run(user.id, user.company_id);
  }
  return { ok: true };
}

export function getSubscriptions(db: Db, user: SessionUser): ApiResult {
  const rows = db
    .prepare(
      `SELECT channel, enabled FROM message_subscriptions WHERE user_id = ? AND company_id = ?`
    )
    .all(user.id, user.company_id) as Array<{ channel: string; enabled: number }>;
  const enabledMap = new Map(rows.map((row) => [row.channel, Number(row.enabled) === 1]));
  return {
    ok: true,
    data: {
      channels: MESSAGE_CHANNELS.map((channel) => ({
        key: channel.key,
        label: channel.label,
        description: channel.description,
        locked: Boolean(channel.locked),
        enabled: channel.locked ? true : enabledMap.has(channel.key) ? enabledMap.get(channel.key)! : true,
      })),
    },
  };
}

export function saveSubscriptions(db: Db, user: SessionUser, payload: any): ApiResult {
  const incoming = payload?.channels;
  if (!incoming || typeof incoming !== "object") {
    return { ok: false, message: "订阅设置格式无效" };
  }
  const now = nowIso();
  const tx = db.transaction(() => {
    for (const channel of MESSAGE_CHANNELS) {
      if (channel.locked) {
        db.prepare(
          `INSERT INTO message_subscriptions(user_id, company_id, channel, enabled, updated_at)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT(user_id, channel) DO UPDATE SET enabled=1, updated_at=excluded.updated_at`
        ).run(user.id, user.company_id, channel.key, now);
        continue;
      }
      if (!(channel.key in incoming)) continue;
      const enabled = incoming[channel.key] ? 1 : 0;
      db.prepare(
        `INSERT INTO message_subscriptions(user_id, company_id, channel, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, channel) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at`
      ).run(user.id, user.company_id, channel.key, enabled, now);
    }
  });
  tx();
  writeAudit(db, user, "message.subscriptions.save", "message_subscriptions", user.id, incoming);
  return getSubscriptions(db, user);
}
