type ApiResult<T = any> = { ok: true; data: T } | { ok: false; message: string; code?: number };

const state = {
  token: localStorage.getItem("weilaijia.token") || "",
  user: null as any,
  tab: "dashboard",
  apiBase: "http://127.0.0.1:8787",
  cache: {} as Record<string, any>,
};

async function initApiBase() {
  const w = window as any;
  if (w.weilaijia?.getMeta) {
    try {
      const meta = await w.weilaijia.getMeta();
      if (meta?.api) state.apiBase = meta.api;
    } catch {
      /* ignore */
    }
  }
}

async function api<T = any>(action: string, payload: any = {}): Promise<ApiResult<T>> {
  const res = await fetch(`${state.apiBase}/api/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: JSON.stringify({ action, payload }),
  });
  return res.json();
}

function toast(message: string, type: "ok" | "error" | "warn" = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type === "ok" ? "" : type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function roleLabel(role: string) {
  return (
    {
      admin: "管理员",
      store_manager: "店长",
      agent: "经纪人",
      finance: "财务",
    } as Record<string, string>
  )[role] || role;
}

function houseStatusLabel(status: string, dealType: string) {
  const map: Record<string, [string, string]> = {
    draft: ["草稿", "草稿"],
    available: ["在售", "待租"],
    suspended: ["暂缓", "暂缓"],
    deal_pending: ["成交中", "成交中"],
    closed: ["已售", "已租"],
    withdrawn: ["已撤盘", "已撤盘"],
  };
  const pair = map[status] || [status, status];
  return dealType === "rent" ? pair[1] : pair[0];
}

function money(n: number) {
  return Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function el(html: string) {
  const box = document.createElement("div");
  box.innerHTML = html.trim();
  return box.firstElementChild as HTMLElement;
}

function canSee(tab: string) {
  const role = state.user?.role;
  if (!role) return false;
  if (tab === "org" || tab === "audit") return role === "admin" || (tab === "audit" && role === "store_manager");
  if (tab === "offboarding") return ["admin", "store_manager"].includes(role);
  if (tab === "expenses") return true;
  if (tab === "cashbook") return ["admin", "finance", "store_manager"].includes(role);
  if (tab === "workforce") return ["admin", "store_manager"].includes(role);
  if (tab === "recruitment") return ["admin", "store_manager"].includes(role);
  if (tab === "customer-care") return role !== "finance";
  if (tab === "marketing") return role !== "finance";
  if (tab === "performance") return true;
  if (tab === "deal-ext") return true;
  if (tab === "property-ext") return role !== "finance";
  if (
    [
      "houses",
      "customers",
      "follows",
      "views",
      "communities",
      "keys",
      "surveys",
      "verifications",
    ].includes(tab)
  )
    return role !== "finance";
  if (tab === "payments") return ["admin", "finance", "store_manager"].includes(role);
  if (tab === "finance-assets")
    return ["admin", "finance", "store_manager"].includes(role);
  if (tab === "office-collab") return role !== "finance";
  if (role === "finance" && tab.startsWith("suite-")) return false;
  return true;
}

async function render() {
  const root = document.getElementById("app")!;
  if (!state.token || !state.user) {
    root.innerHTML = "";
    root.appendChild(renderLogin());
    return;
  }
  const preferences = await api("config.preferences.get");
  if (preferences.ok) applyPreferences(preferences.data as any);
  root.innerHTML = "";
  const shell = el(`
    <div class="shell">
      <aside class="side"></aside>
      <main class="main"></main>
    </div>
  `);
  root.appendChild(shell);
  renderSide(shell.querySelector(".side")!);
  await renderMain(shell.querySelector(".main")!);
}

function applyPreferences(preferences: any) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme =
    preferences.theme === "system" ? (prefersDark ? "dark" : "light") : preferences.theme;
  document.body.dataset.theme = theme || "light";
  document.body.dataset.density = preferences.list_density || "comfortable";
  document.body.dataset.watermark = preferences.watermark_enabled ? state.user?.display_name : "";
}

function renderLogin() {
  const node = el(`
    <div class="login-wrap">
      <form class="login-card">
        <h1>未来家本地</h1>
        <p>自研中介业务系统 · MVP 演示</p>
        <label>账号</label>
        <input name="account" value="agent_a" autocomplete="username" />
        <label>密码</label>
        <input name="password" type="password" value="123456" autocomplete="current-password" />
        <button class="btn block" type="submit">登录</button>
        <div class="hint">演示账号：admin / manager / agent_a / agent_b / finance / agent_c<br/>默认密码：123456</div>
      </form>
    </div>
  `);
  node.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const res = await api("auth.login", {
      account: String(fd.get("account") || ""),
      password: String(fd.get("password") || ""),
    });
    if (!res.ok) return toast(res.message, "error");
    state.token = res.data.token;
    state.user = res.data.user;
    localStorage.setItem("weilaijia.token", state.token);
    toast("登录成功");
    render();
  });
  return node;
}

function renderSide(side: HTMLElement) {
  const tabs = [
    ["dashboard", "工作台"],
    ["houses", "房源"],
    ["communities", "楼盘字典"],
    ["keys", "钥匙"],
    ["surveys", "实勘"],
    ["verifications", "验真"],
    ["customers", "客源"],
    ["follows", "跟进"],
    ["views", "带看"],
    ["deals", "成交"],
    ["earnest", "意向金"],
    ["transfer", "过户节点"],
    ["payments", "收款"],
    ["commissions", "提成"],
    ["reports", "经营报表"],
    ["property-ext", "房源扩展"],
    ["deal-ext", "交易扩展"],
    ["suite-newhome", "新房分销"],
    ["finance-assets", "资产凭证"],
    ["cashbook", "收支流水"],
    ["expenses", "费用报销"],
    ["office-content", "公告知识"],
    ["office-collab", "办公协同"],
    ["mortgage-calc", "房贷计算"],
    ["payroll", "薪酬工资条"],
    ["workforce", "岗位调动"],
    ["recruitment", "招聘管理"],
    ["employee-contracts", "员工合同"],
    ["attendance-leave", "考勤请假"],
    ["offboarding", "离职交接"],
    ["rental", "租赁托管"],
    ["customer-care", "客户关怀"],
    ["marketing", "营销线索"],
    ["performance", "积分分红"],
    ["system-center", "系统中心"],
    ["messages", "消息"],
    ["org", "组织"],
    ["audit", "审计"],
  ].filter(([id]) => canSee(id));

  side.innerHTML = `
    <div class="brand">
      <div class="logo">未</div>
      <div><strong>未来家本地</strong><span>门店主链路 MVP</span></div>
    </div>
    <div class="user-box">
      <div>${state.user.display_name}</div>
      <div>${roleLabel(state.user.role)}</div>
    </div>
    ${tabs
      .map(
        ([id, label]) =>
          `<button class="nav-btn ${state.tab === id ? "on" : ""}" data-tab="${id}">${label}</button>`
      )
      .join("")}
    <button class="nav-btn" data-logout="1">退出登录</button>
    <div class="side-foot">本地 SQLite · 禁止厂商许可</div>
  `;
  side.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = (btn as HTMLElement).dataset.tab!;
      render();
    });
  });
  side.querySelector("[data-logout]")!.addEventListener("click", async () => {
    await api("auth.logout");
    state.token = "";
    state.user = null;
    localStorage.removeItem("weilaijia.token");
    render();
  });
}

async function renderMain(main: HTMLElement) {
  if (state.tab === "dashboard") return renderDashboard(main);
  if (state.tab === "houses") return renderHouses(main);
  if (state.tab === "communities") return renderCommunities(main);
  if (state.tab === "keys") return renderKeys(main);
  if (state.tab === "surveys") return renderSurveys(main);
  if (state.tab === "verifications") return renderVerifications(main);
  if (state.tab === "customers") return renderCustomers(main);
  if (state.tab === "follows") return renderFollows(main);
  if (state.tab === "views") return renderViews(main);
  if (state.tab === "deals") return renderDeals(main);
  if (state.tab === "earnest") return renderEarnest(main);
  if (state.tab === "transfer") return renderTransfer(main);
  if (state.tab === "payments") return renderPayments(main);
  if (state.tab === "commissions") return renderCommissions(main);
  if (state.tab === "reports") return renderReports(main);
  if (state.tab === "suite-newhome") return renderNewhome(main);
  if (state.tab === "offboarding") return renderOffboarding(main);
  if (state.tab === "expenses") return renderExpenses(main);
  if (state.tab === "attendance-leave") return renderAttendanceLeave(main);
  if (state.tab === "cashbook") return renderCashbook(main);
  if (state.tab === "workforce") return renderWorkforce(main);
  if (state.tab === "recruitment") return renderRecruitment(main);
  if (state.tab === "employee-contracts") return renderEmployeeContracts(main);
  if (state.tab === "payroll") return renderPayroll(main);
  if (state.tab === "office-content") return renderOfficeContent(main);
  if (state.tab === "rental") return renderRental(main);
  if (state.tab === "customer-care") return renderCustomerCare(main);
  if (state.tab === "marketing") return renderMarketing(main);
  if (state.tab === "performance") return renderPerformance(main);
  if (state.tab === "deal-ext") return renderDealExt(main);
  if (state.tab === "property-ext") return renderPropertyExt(main);
  if (state.tab === "finance-assets") return renderFinanceAssets(main);
  if (state.tab === "office-collab") return renderOfficeCollab(main);
  if (state.tab === "mortgage-calc") return renderMortgageCalc(main);
  if (state.tab === "system-center") return renderSystemCenter(main);
  if (state.tab === "messages") return renderMessages(main);
  if (state.tab === "org") return renderOrg(main);
  if (state.tab === "audit") return renderAudit(main);
}

async function renderDashboard(main: HTMLElement) {
  const res = await api("report.dashboard");
  if (!res.ok) {
    main.innerHTML = `<div class="error">${res.message}</div>`;
    return;
  }
  const d = res.data;
  main.innerHTML = `
    <div class="header"><h2>工作台</h2></div>
    <div class="row"><div>
      <strong>${escapeHtml(d.company_name || "本公司")}</strong>
      <div class="meta">门店 ${d.store_count ?? 0} · 在职员工 ${d.employee_count ?? 0}</div>
    </div></div>
    <div class="stats">
      <div class="stat"><div class="n">${d.available_houses}</div><div class="l">在售/待租</div></div>
      <div class="stat"><div class="n">${d.private_customers}</div><div class="l">私客</div></div>
      <div class="stat"><div class="n">${d.public_customers}</div><div class="l">公客</div></div>
      <div class="stat"><div class="n">${d.follow_today}</div><div class="l">今日待跟进</div></div>
      <div class="stat"><div class="n">${d.follow_overdue}</div><div class="l">逾期跟进</div></div>
      <div class="stat"><div class="n">${d.today_views}</div><div class="l">今日带看</div></div>
      <div class="stat"><div class="n">${d.pending_deals}</div><div class="l">待审批成交</div></div>
      <div class="stat"><div class="n">${money(d.unpaid_total)}</div><div class="l">未收佣金</div></div>
    </div>
    <div class="row"><div>
      <strong>主路径提示</strong>
      <div class="meta">录盘 → 录客 → 跟进 → 带看 → 提交成交 → 店长审批 → 财务收款 → 查看提成</div>
    </div></div>
  `;
}

function openDialog(title: string, fieldsHtml: string, onSubmit: (fd: FormData) => Promise<void>) {
  const backdrop = el(`
    <div class="dialog-backdrop">
      <form class="dialog">
        <h3>${title}</h3>
        <div class="form-grid">${fieldsHtml}</div>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" data-cancel>取消</button>
          <button class="btn" type="submit">保存</button>
        </div>
      </form>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector("[data-cancel]")!.addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    await onSubmit(new FormData(e.target as HTMLFormElement));
    backdrop.remove();
    render();
  });
  return backdrop;
}

function openInfoDialog(title: string, bodyHtml: string) {
  const backdrop = el(`
    <div class="dialog-backdrop">
      <div class="dialog">
        <h3>${title}</h3>
        <div class="list">${bodyHtml}</div>
        <div class="dialog-actions">
          <button type="button" class="btn" data-close>关闭</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector("[data-close]")!.addEventListener("click", () => backdrop.remove());
}

async function renderHouses(main: HTMLElement) {
  const res = await api("house.list", {});
  const desktopShell = (window as any).weilaijia?.shell;
  main.innerHTML = `
    <div class="header">
      <h2>房源</h2>
      <button class="btn" data-new>新建房源</button>
    </div>
    <div class="filters">
      <select data-f="deal_type"><option value="">全部类型</option><option value="sale">出售</option><option value="rent">出租</option></select>
      <select data-f="property_type"><option value="">全部物业</option><option value="residential">住宅</option><option value="shop">商铺</option><option value="office">写字楼</option><option value="parking">车位</option><option value="villa">别墅</option></select>
      <select data-f="status"><option value="">全部状态</option><option value="available">在售/待租</option><option value="draft">草稿</option><option value="suspended">暂缓</option><option value="closed">已成交</option></select>
      <input data-f="keyword" placeholder="搜索小区/标题" />
    </div>
    <div class="list" data-list></div>
  `;
  const list = main.querySelector("[data-list]")!;
  const draw = async () => {
    const q: any = {};
    main.querySelectorAll("[data-f]").forEach((input) => {
      const el = input as HTMLInputElement;
      if (el.value) q[el.dataset.f!] = el.value;
    });
    const r = await api("house.list", q);
    if (!r.ok) {
      list.innerHTML = `<div class="error">${r.message}</div>`;
      return;
    }
    const rows = r.data as any[];
    if (!rows.length) {
      list.innerHTML = `<div class="empty">暂无房源，点击右上角新建</div>`;
      return;
    }
    const roleEntries = await Promise.all(
      rows.map(async (house) => [house.id, await api("house.roles.list", { house_id: house.id })])
    );
    const houseRoles = new Map(roleEntries as Array<[string, ApiResult]>);
    const entrustmentEntries = await Promise.all(
      rows.map(async (house) => [
        house.id,
        await api("entrustment.list", { house_id: house.id }),
      ])
    );
    const entrustments = new Map(entrustmentEntries as Array<[string, ApiResult]>);
    const roleLabels: Record<string, string> = {
      surveyor: "实勘",
      verifier: "核验",
      photographer: "摄影",
      floorplan: "户型",
      key_keeper: "钥匙",
      entrustment: "委托",
    };
    list.innerHTML = rows
      .map(
        (h) => `
      <div class="row">
        <div>
          <div><span class="tag">${h.deal_type === "sale" ? "售" : "租"}</span>
          <span class="tag ${h.status === "available" ? "ok" : ""}">${houseStatusLabel(h.status, h.deal_type)}</span>
          ${h.is_private ? `<span class="tag warn">保密盘</span>` : ""}
          ${h.is_locked ? `<span class="tag warn">已锁定</span>` : ""}
          <strong>${h.title}</strong></div>
          <div class="meta">${h.community} · ${h.price}${h.price_unit === "wan" ? " 万" : " 元/月"} · 业主 ${h.owner_name} ${h.owner_phone}${h.owner_phone_masked ? "（已脱敏）" : ""}${h.force_follow_required ? " · 须写跟进后查看" : ""}</div>
          ${houseRoles.get(h.id)?.ok && (houseRoles.get(h.id) as any).data.length ? `<div class="meta">角色人 ${(houseRoles.get(h.id) as any).data.map((item: any) => `${roleLabels[item.role_type] || item.role_type}：${item.display_name}`).join(" · ")}</div>` : ""}
          ${entrustments.get(h.id)?.ok && (entrustments.get(h.id) as any).data[0] ? `<div class="meta">委托 ${(entrustments.get(h.id) as any).data[0].entrust_type} · ${(entrustments.get(h.id) as any).data[0].status} · 至 ${(entrustments.get(h.id) as any).data[0].end_at.slice(0, 10)}</div>` : ""}
        </div>
        <div class="ops">
          ${h.force_follow_required ? `<button class="btn" data-reveal-house="${h.id}">写跟进看电话</button>` : ""}
          ${h.status === "draft" ? `<button class="btn ghost" data-status="${h.id}" data-to="available">上架</button>` : ""}
          ${h.status === "available" ? `<button class="btn ghost" data-status="${h.id}" data-to="suspended">暂缓</button>` : ""}
          ${!["closed", "withdrawn"].includes(h.status) ? `<button class="btn ghost" data-lock="${h.id}" data-locked="${h.is_locked ? "0" : "1"}">${h.is_locked ? "解锁" : "锁定"}</button>` : ""}
          <button class="btn ghost" data-photos="${h.id}">图片</button>
          <button class="btn ghost" data-related="${h.id}">同业主</button>
          <button class="btn ghost" data-roles="${h.id}">角色人</button>
          <button class="btn ghost" data-entrustment="${h.id}">委托</button>
          ${["available", "suspended", "draft"].includes(h.status) ? `<button class="btn danger" data-withdraw="${h.id}">撤盘</button>` : ""}
        </div>
      </div>`
      )
      .join("");
    list.querySelectorAll("[data-reveal-house]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const houseId = (btn as HTMLElement).dataset.revealHouse!;
        openDialog(
          "写跟进后查看业主电话",
          `<label class="full">跟进内容<textarea name="content" rows="4" required placeholder="至少 5 个字"></textarea></label>
           <label>方式<select name="method"><option value="phone">电话</option><option value="wechat">微信</option><option value="visit">拜访</option><option value="other">其他</option></select></label>`,
          async (fd) => {
            const result = await api("contact.reveal", {
              target_type: "house",
              target_id: houseId,
              content: fd.get("content"),
              method: fd.get("method"),
            });
            if (!result.ok) return toast(result.message, "error");
            toast(`业主电话：${(result.data as any).phone}`, "ok");
            draw();
          }
        );
      });
    });
    list.querySelectorAll("[data-related]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const result = await api("house.relatedByOwner", {
          id: (btn as HTMLElement).dataset.related,
        });
        if (!result.ok) return toast(result.message, "error");
        const payload = result.data as any;
        const items = payload.items as any[];
        openInfoDialog(
          `同业主相关盘（${payload.owner_name} · ${payload.owner_phone}）`,
          items.length
            ? items
                .map(
                  (item) =>
                    `<div class="row"><div><strong>${escapeHtml(item.title)}</strong><div class="meta">${escapeHtml(item.community)} · ${item.price}${item.price_unit === "wan" ? " 万" : " 元/月"} · ${houseStatusLabel(item.status, item.deal_type)}</div></div></div>`
                )
                .join("")
            : `<div class="empty">暂无其他可见相关盘</div>`
        );
      });
    });
    list.querySelectorAll("[data-photos]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const houseId = (btn as HTMLElement).dataset.photos!;
        const listed = await api("attachment.list", {
          parent_type: "house",
          parent_id: houseId,
        });
        if (!listed.ok) return toast(listed.message, "error");
        const files = (listed.data as any[]).filter((file) =>
          ["photo", "image", "cover", "floorplan"].includes(file.category)
        );
        const canUpload = ["admin", "store_manager", "agent"].includes(state.user.role);
        const dialog = openInfoDialog(
          "房源图片",
          `
          ${
            files.length
              ? files
                  .map(
                    (file) =>
                      `<div class="row"><div><strong>${escapeHtml(file.name)}</strong><div class="meta">${escapeHtml(file.category)} · ${escapeHtml(file.local_path)}</div></div>
                      <div class="ops"><button class="btn danger" data-del-photo="${file.id}">删除</button></div></div>`
                  )
                  .join("")
              : `<div class="empty">暂无图片附件</div>`
          }
          ${canUpload && desktopShell?.chooseFiles ? `<div class="ops" style="margin-top:12px"><button class="btn" data-add-photo>上传图片</button></div>` : ""}
          `
        );
        dialog.querySelectorAll("[data-del-photo]").forEach((delBtn) => {
          delBtn.addEventListener("click", async () => {
            const reason = prompt("删除原因（必填）");
            if (!reason) return;
            const result = await api("attachment.delete", {
              id: (delBtn as HTMLElement).dataset.delPhoto,
              reason,
            });
            toast(result.ok ? "图片已删除" : result.message, result.ok ? "ok" : "error");
            if (result.ok) {
              dialog.remove();
              draw();
            }
          });
        });
        dialog.querySelector("[data-add-photo]")?.addEventListener("click", async () => {
          if (!desktopShell?.chooseFiles) return toast("请在 Electron 桌面端上传图片", "error");
          const paths = (await desktopShell.chooseFiles()) as string[];
          for (const localPath of paths) {
            const name = localPath.split(/[\\/]/).pop() || "图片";
            const added = await api("attachment.add", {
              parent_type: "house",
              parent_id: houseId,
              category: "photo",
              name,
              local_path: localPath,
            });
            if (!added.ok) return toast(added.message, "error");
          }
          toast(paths.length ? `已上传 ${paths.length} 张图片` : "未选择文件");
          dialog.remove();
          draw();
        });
      });
    });
    list.querySelectorAll("[data-status]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.status!;
        const to = (btn as HTMLElement).dataset.to!;
        const r = await api("house.status", { id, status: to });
        toast(r.ok ? "状态已更新" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      });
    });
    list.querySelectorAll("[data-withdraw]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const reason = prompt("请输入撤盘原因");
        if (!reason) return;
        const r = await api("house.status", {
          id: (btn as HTMLElement).dataset.withdraw,
          status: "withdrawn",
          reason,
        });
        toast(r.ok ? "已撤盘" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      });
    });
    list.querySelectorAll("[data-lock]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const locking = (btn as HTMLElement).dataset.locked === "1";
        const reason = prompt(locking ? "锁定原因" : "解锁原因");
        if (!reason) return;
        const result = await api("house.lock", {
          id: (btn as HTMLElement).dataset.lock,
          locked: locking,
          reason,
        });
        toast(result.ok ? "房源锁定状态已更新" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      });
    });
    list.querySelectorAll("[data-roles]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const houseId = (btn as HTMLElement).dataset.roles!;
        const [rolesResult, usersResult] = await Promise.all([
          api("house.roles.list", { house_id: houseId }),
          api("org.users.store", {}),
        ]);
        if (!rolesResult.ok) return toast(rolesResult.message, "error");
        const roles = rolesResult.data as any[];
        if (!["admin", "store_manager"].includes(state.user.role)) {
          return toast(
            roles.length
              ? roles.map((item) => `${roleLabels[item.role_type] || item.role_type}：${item.display_name}`).join("；")
              : "暂无角色人",
            "warn"
          );
        }
        const userOptions = usersResult.ok
          ? (usersResult.data as any[])
              .map((employee) => `<option value="${employee.id}">${employee.display_name}</option>`)
              .join("")
          : "";
        const removeOptions = roles
          .map(
            (item) =>
              `<option value="${item.id}">${roleLabels[item.role_type] || item.role_type}：${item.display_name}</option>`
          )
          .join("");
        openDialog(
          "管理房源角色人",
          `
          <label>操作<select name="action"><option value="assign">指派/更新</option><option value="remove">解除</option></select></label>
          <label>角色<select name="role_type">${Object.entries(roleLabels)
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join("")}</select></label>
          <label>员工<select name="user_id">${userOptions}</select></label>
          <label>保护至<input name="protected_until" type="date" /></label>
          <label class="full">解除现有角色<select name="remove_id"><option value="">请选择</option>${removeOptions}</select></label>
          <label class="full">保护期内解除原因<input name="reason" /></label>
          `,
          async (fd) => {
            const removing = fd.get("action") === "remove";
            const result = removing
              ? await api("house.roles.remove", {
                  id: fd.get("remove_id"),
                  reason: fd.get("reason"),
                })
              : await api("house.roles.assign", {
                  house_id: houseId,
                  role_type: fd.get("role_type"),
                  user_id: fd.get("user_id"),
                  protected_until: fd.get("protected_until") || null,
                });
            toast(result.ok ? (removing ? "角色已解除" : "角色已指派") : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        );
      });
    });
    list.querySelectorAll("[data-entrustment]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const houseId = (btn as HTMLElement).dataset.entrustment!;
        const current = await api("entrustment.list", { house_id: houseId });
        if (!current.ok) return toast(current.message, "error");
        const records = current.data as any[];
        const options = records
          .map(
            (item) =>
              `<option value="${item.id}">${item.entrust_type} · ${item.status} · ${item.end_at.slice(0, 10)}</option>`
          )
          .join("");
        openDialog(
          "业主委托管理",
          `
          <label>操作<select name="action"><option value="register">登记</option><option value="renew">续期</option><option value="terminate">终止</option>${desktopShell ? `<option value="attach">上传扫描件</option>` : ""}</select></label>
          <label>现有委托<select name="id"><option value="">请选择</option>${options}</select></label>
          <label>委托类型<select name="entrust_type"><option value="general">普通委托</option><option value="exclusive">独家委托</option><option value="rental_management">租赁托管</option></select></label>
          <label>开始日期<input name="start_at" type="date" /></label>
          <label>到期日期<input name="end_at" type="date" /></label>
          <label>签署日期<input name="signed_at" type="date" /></label>
          <label class="full">备注/终止原因<input name="remark" /></label>
          `,
          async (fd) => {
            const action = String(fd.get("action"));
            if (action === "attach") {
              const paths = (await desktopShell.chooseFiles()) as string[];
              for (const localPath of paths) {
                const name = localPath.split(/[\\/]/).pop() || "委托扫描件";
                const added = await api("attachment.add", {
                  parent_type: "house",
                  parent_id: houseId,
                  category: "entrustment",
                  name,
                  local_path: localPath,
                });
                if (!added.ok) return toast(added.message, "error");
              }
              toast(paths.length ? `已添加 ${paths.length} 个委托扫描件` : "未选择文件");
              if (paths.length) draw();
              return;
            }
            const result =
              action === "renew"
                ? await api("entrustment.renew", {
                    id: fd.get("id"),
                    end_at: fd.get("end_at"),
                  })
                : action === "terminate"
                  ? await api("entrustment.terminate", {
                      id: fd.get("id"),
                      reason: fd.get("remark"),
                    })
                  : await api("entrustment.register", {
                      house_id: houseId,
                      entrust_type: fd.get("entrust_type"),
                      start_at: fd.get("start_at"),
                      end_at: fd.get("end_at"),
                      signed_at: fd.get("signed_at") || null,
                      remark: fd.get("remark"),
                    });
            toast(result.ok ? "委托信息已更新" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        );
      });
    });
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    openDialog(
      "新建房源",
      `
      <label>标题<input name="title" required /></label>
      <label>类型<select name="deal_type"><option value="sale">出售</option><option value="rent">出租</option></select></label>
      <label>物业<select name="property_type"><option value="residential">住宅</option><option value="shop">商铺</option><option value="office">写字楼</option><option value="parking">车位</option><option value="villa">别墅</option></select></label>
      <label>交易模式<select name="deal_mode"><option value="normal">普通</option><option value="auction">拍卖</option><option value="exclusive">包销/独家</option></select></label>
      <label>小区<input name="community" required /></label>
      <label>价格<input name="price" type="number" step="0.01" required /></label>
      <label>业主姓名<input name="owner_name" required /></label>
      <label>业主电话<input name="owner_phone" required /></label>
      <label>面积㎡<input name="area_size" type="number" step="0.01" /></label>
      <label>户型<input name="rooms" placeholder="2室1厅" /></label>
      <label class="full">地址<input name="address" /></label>
      <label class="full">备注<input name="remark" /></label>
      <label><span><input name="is_private" type="checkbox" /> 保密盘</span></label>
      `,
      async (fd) => {
        const res = await api("house.create", {
          title: fd.get("title"),
          deal_type: fd.get("deal_type"),
          property_type: fd.get("property_type"),
          deal_mode: fd.get("deal_mode"),
          community: fd.get("community"),
          price: Number(fd.get("price")),
          owner_name: fd.get("owner_name"),
          owner_phone: fd.get("owner_phone"),
          area_size: fd.get("area_size") ? Number(fd.get("area_size")) : null,
          rooms: fd.get("rooms") || null,
          address: fd.get("address") || null,
          remark: fd.get("remark") || null,
          is_private: fd.get("is_private") === "on",
          status: "available",
        });
        if (res.ok && (res.data as any).duplicate_hint) {
          toast(`房源已创建，但可能重复：${(res.data as any).duplicate_hint.title}`, "warn");
        } else {
          toast(res.ok ? "房源已创建" : res.message, res.ok ? "ok" : "error");
        }
      }
    );
  });
  main.querySelectorAll("[data-f]").forEach((input) =>
    input.addEventListener("change", draw)
  );
  main.querySelector("[data-f=keyword]")!.addEventListener("input", draw);
  await draw();
}

async function renderCommunities(main: HTMLElement) {
  main.innerHTML = `
    <div class="header"><h2>楼盘字典</h2><button class="btn" data-new>新建小区</button></div>
    <div class="filters"><input data-keyword placeholder="搜索小区/片区/地址" /></div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const keyword = (main.querySelector("[data-keyword]") as HTMLInputElement).value;
    const result = await api("property.communities.list", { keyword });
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const rows = result.data as any[];
    list.innerHTML =
      rows
        .map(
          (item) => `<div class="row"><div>
            <strong>${item.name}</strong>
            <div class="meta">${item.district || "未填片区"} · ${item.address || "未填地址"} · ${item.building_count || 0} 栋 · ${item.house_count} 套房源</div>
          </div></div>`
        )
        .join("") || `<div class="empty">暂无自建小区</div>`;
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    openDialog(
      "新建小区",
      `
      <label>小区名称<input name="name" required /></label>
      <label>片区<input name="district" /></label>
      <label class="full">地址<input name="address" /></label>
      <label>楼栋数<input name="building_count" type="number" min="0" /></label>
      <label>备注<input name="remark" /></label>
      `,
      async (fd) => {
        const result = await api("property.communities.upsert", {
          name: fd.get("name"),
          district: fd.get("district"),
          address: fd.get("address"),
          building_count: fd.get("building_count")
            ? Number(fd.get("building_count"))
            : null,
          remark: fd.get("remark"),
        });
        toast(result.ok ? "小区已创建" : result.message, result.ok ? "ok" : "error");
      }
    );
  });
  main.querySelector("[data-keyword]")!.addEventListener("input", draw);
  await draw();
}

async function renderKeys(main: HTMLElement) {
  const houses = await api("house.list", {});
  main.innerHTML = `
    <div class="header"><h2>钥匙管理</h2><button class="btn" data-new>登记钥匙</button></div>
    <div class="filters">
      <select data-status><option value="">全部状态</option><option value="stored">在店</option><option value="borrowed">借出</option><option value="invalid">作废</option></select>
    </div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const status = (main.querySelector("[data-status]") as HTMLSelectElement).value;
    const result = await api("property.keys.list", status ? { status } : {});
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const rows = result.data as any[];
    list.innerHTML =
      rows
        .map(
          (key) => `<div class="row"><div>
            <div><span class="tag ${key.status === "stored" ? "ok" : key.status === "borrowed" ? "warn" : "danger"}">${key.status === "stored" ? "在店" : key.status === "borrowed" ? "借出" : "作废"}</span><strong>${key.key_no}</strong> · ${key.house_title}</div>
            <div class="meta">${key.borrower_name ? `借用人 ${key.borrower_name}` : "未借出"}${key.expected_return_at ? ` · 应还 ${key.expected_return_at}` : ""}</div>
          </div><div class="ops">
            ${key.status === "stored" ? `<button class="btn" data-borrow="${key.id}">借出</button>` : ""}
            ${key.status === "borrowed" ? `<button class="btn" data-return="${key.id}">归还</button>` : ""}
            ${key.status === "stored" && ["admin", "store_manager"].includes(state.user.role) ? `<button class="btn danger" data-invalid="${key.id}">作废</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无钥匙记录</div>`;
    list.querySelectorAll("[data-borrow]").forEach((button) =>
      button.addEventListener("click", async () => {
        const expected = prompt("预计归还时间（可留空，示例 2026-08-10 18:00）") || null;
        const result = await api("property.keys.borrow", {
          id: (button as HTMLElement).dataset.borrow,
          expected_return_at: expected,
        });
        toast(result.ok ? "钥匙已借出" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-return]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("property.keys.return", {
          id: (button as HTMLElement).dataset.return,
        });
        toast(result.ok ? "钥匙已归还" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-invalid]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("作废原因");
        if (!reason) return;
        const result = await api("property.keys.invalidate", {
          id: (button as HTMLElement).dataset.invalid,
          reason,
        });
        toast(result.ok ? "钥匙已作废" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    const options = ((houses.data as any[]) || [])
      .map((house) => `<option value="${house.id}">${house.title}</option>`)
      .join("");
    openDialog(
      "登记钥匙",
      `
      <label class="full">房源<select name="house_id">${options}</select></label>
      <label>钥匙编号<input name="key_no" required /></label>
      <label>备注<input name="remark" /></label>
      `,
      async (fd) => {
        const result = await api("property.keys.register", {
          house_id: fd.get("house_id"),
          key_no: fd.get("key_no"),
          remark: fd.get("remark"),
        });
        toast(result.ok ? "钥匙已登记" : result.message, result.ok ? "ok" : "error");
      }
    );
  });
  main.querySelector("[data-status]")!.addEventListener("change", draw);
  await draw();
}

async function renderSurveys(main: HTMLElement) {
  const houses = await api("house.list", {});
  main.innerHTML = `
    <div class="header"><h2>实勘 / 空看</h2><button class="btn" data-new>新增记录</button></div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const result = await api("property.surveys.list", {});
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const rows = result.data as any[];
    list.innerHTML =
      rows
        .map(
          (survey) => `<div class="row"><div>
            <div><span class="tag ok">${survey.survey_type === "survey" ? "实勘" : "空看"}</span><strong>${survey.house_title}</strong></div>
            <div class="meta">${survey.summary} · ${survey.survey_user_name} · ${survey.survey_at}</div>
          </div></div>`
        )
        .join("") || `<div class="empty">暂无实勘记录</div>`;
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    const options = ((houses.data as any[]) || [])
      .map((house) => `<option value="${house.id}">${house.title}</option>`)
      .join("");
    openDialog(
      "新增实勘/空看",
      `
      <label class="full">房源<select name="house_id">${options}</select></label>
      <label>类型<select name="survey_type"><option value="survey">实勘</option><option value="vacant_view">空看</option></select></label>
      <label>时间<input name="survey_at" type="datetime-local" /></label>
      <label class="full">摘要<textarea name="summary" rows="4" required></textarea></label>
      `,
      async (fd) => {
        const rawTime = String(fd.get("survey_at") || "");
        const result = await api("property.surveys.create", {
          house_id: fd.get("house_id"),
          survey_type: fd.get("survey_type"),
          survey_at: rawTime ? new Date(rawTime).toISOString() : null,
          summary: fd.get("summary"),
        });
        toast(result.ok ? "实勘记录已保存" : result.message, result.ok ? "ok" : "error");
      }
    );
  });
  await draw();
}

async function renderVerifications(main: HTMLElement) {
  const houses = await api("house.list", {});
  main.innerHTML = `
    <div class="header"><h2>房源验真</h2><button class="btn" data-new>提交验真</button></div>
    <div class="filters">
      <select data-status><option value="">全部状态</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option></select>
    </div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const status = (main.querySelector("[data-status]") as HTMLSelectElement).value;
    const result = await api("property.verifications.list", status ? { status } : {});
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const rows = result.data as any[];
    list.innerHTML =
      rows
        .map(
          (record) => `<div class="row"><div>
            <div><span class="tag ${record.status === "approved" ? "ok" : record.status === "rejected" ? "danger" : "warn"}">${record.status === "pending" ? "待审核" : record.status === "approved" ? "已通过" : "已驳回"}</span><strong>${record.house_title}</strong></div>
            <div class="meta">${record.contact_result || "无联系说明"} · 确认价 ${record.price_confirmed ?? "-"} · ${record.submitted_by_name}${record.reject_reason ? ` · ${record.reject_reason}` : ""}</div>
          </div><div class="ops">
            ${record.status === "pending" && ["admin", "store_manager"].includes(state.user.role) ? `<button class="btn" data-approve="${record.id}">通过</button><button class="btn danger" data-reject="${record.id}">驳回</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无验真记录</div>`;
    list.querySelectorAll("[data-approve]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("property.verifications.review", {
          id: (button as HTMLElement).dataset.approve,
          status: "approved",
        });
        toast(result.ok ? "验真已通过" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-reject]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("驳回原因");
        if (!reason) return;
        const result = await api("property.verifications.review", {
          id: (button as HTMLElement).dataset.reject,
          status: "rejected",
          reason,
        });
        toast(result.ok ? "验真已驳回" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    const options = ((houses.data as any[]) || [])
      .map((house) => `<option value="${house.id}">${house.title}</option>`)
      .join("");
    openDialog(
      "提交验真",
      `
      <label class="full">房源<select name="house_id">${options}</select></label>
      <label>确认价格<input name="price_confirmed" type="number" step="0.01" /></label>
      <label><span><input name="availability_confirmed" type="checkbox" checked /> 业主确认有效</span></label>
      <label class="full">联系结果<textarea name="contact_result" rows="3"></textarea></label>
      `,
      async (fd) => {
        const result = await api("property.verifications.submit", {
          house_id: fd.get("house_id"),
          price_confirmed: fd.get("price_confirmed")
            ? Number(fd.get("price_confirmed"))
            : null,
          availability_confirmed: fd.get("availability_confirmed") === "on",
          contact_result: fd.get("contact_result"),
        });
        toast(result.ok ? "验真已提交" : result.message, result.ok ? "ok" : "error");
      }
    );
  });
  main.querySelector("[data-status]")!.addEventListener("change", draw);
  await draw();
}

async function renderCustomers(main: HTMLElement) {
  main.innerHTML = `
    <div class="header"><h2>客源</h2><div class="ops">
      ${["admin", "store_manager"].includes(state.user.role) ? `<button class="btn ghost" data-run-pool>执行掉公</button>` : ""}
      ${state.user.role === "admin" ? `<button class="btn ghost" data-pool-settings>掉公设置</button>` : ""}
      <button class="btn" data-new>新建客源</button>
    </div></div>
    <div class="filters">
      <select data-f="visibility"><option value="">全部可见性</option><option value="private">私客</option><option value="public">公客</option></select>
      <select data-f="intent"><option value="">全部意图</option><option value="buy">求购</option><option value="rent">求租</option></select>
      <input data-f="keyword" placeholder="搜索姓名/电话" />
    </div>
    <div class="list" data-list></div>
  `;
  const list = main.querySelector("[data-list]")!;
  const draw = async () => {
    const q: any = {};
    main.querySelectorAll("[data-f]").forEach((input) => {
      const el = input as HTMLInputElement;
      if (el.value) q[el.dataset.f!] = el.value;
    });
    const r = await api("customer.list", q);
    if (!r.ok) return (list.innerHTML = `<div class="error">${r.message}</div>`);
    const rows = r.data as any[];
    if (!rows.length) return (list.innerHTML = `<div class="empty">暂无客源</div>`);
    list.innerHTML = rows
      .map(
        (c) => `
      <div class="row"><div>
        <div><span class="tag">${c.visibility === "private" ? "私客" : "公客"}</span>
        <span class="tag">${c.intent === "buy" ? "求购" : "求租"}</span>
        <span class="tag">${c.level}级</span>
        <strong>${c.name}</strong> ${c.phone}${c.phone_masked ? "（已脱敏）" : ""}${c.force_follow_required ? " · 须写跟进后查看" : ""}</div>
        <div class="meta">${c.need || "无需求备注"} · 状态 ${c.status}</div>
      </div>
      <div class="ops">
        ${c.force_follow_required ? `<button class="btn" data-reveal-customer="${c.id}">写跟进看电话</button>` : ""}
        <button class="btn ghost" data-match="${c.id}">匹配房源</button>
        <button class="btn ghost" data-contacts="${c.id}">联系人</button>
        ${["admin", "store_manager"].includes(state.user.role) ? `<button class="btn ghost" data-merge="${c.id}">合并</button>` : ""}
        ${c.visibility === "private" ? `<button class="btn ghost" data-public="${c.id}">转公客</button>` : `<button class="btn" data-claim="${c.id}">认领</button>`}
      </div></div>`
      )
      .join("");
    list.querySelectorAll("[data-reveal-customer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const customerId = (btn as HTMLElement).dataset.revealCustomer!;
        openDialog(
          "写跟进后查看客户电话",
          `<label class="full">跟进内容<textarea name="content" rows="4" required placeholder="至少 5 个字"></textarea></label>
           <label>方式<select name="method"><option value="phone">电话</option><option value="wechat">微信</option><option value="visit">拜访</option><option value="other">其他</option></select></label>`,
          async (fd) => {
            const result = await api("contact.reveal", {
              target_type: "customer",
              target_id: customerId,
              content: fd.get("content"),
              method: fd.get("method"),
            });
            if (!result.ok) return toast(result.message, "error");
            toast(`客户电话：${(result.data as any).phone}`, "ok");
            draw();
          }
        );
      });
    });
    list.querySelectorAll("[data-public]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const reason = prompt("转公客原因") || "转公";
        const r = await api("customer.toPublic", {
          id: (btn as HTMLElement).dataset.public,
          reason,
        });
        toast(r.ok ? "已转公客" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      })
    );
    list.querySelectorAll("[data-match]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const r = await api("customer.matchHouses", {
          id: (btn as HTMLElement).dataset.match,
        });
        if (!r.ok) return toast(r.message, "error");
        const matches = r.data as any[];
        openInfoDialog(
          "匹配房源",
          matches.length
            ? matches
                .map(
                  (h) =>
                    `<div class="row"><div><strong>${h.title}</strong><div class="meta">${h.community} · ${h.price}${h.price_unit === "wan" ? "万" : "元/月"} · ${h.match_reasons.join("、")}</div></div></div>`
                )
                .join("")
            : `<div class="empty">当前没有符合类型和预算的在售房源</div>`
        );
      })
    );
    list.querySelectorAll("[data-contacts]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const customerId = (btn as HTMLElement).dataset.contacts!;
        const contacts = await api("customer.contacts.list", {
          customer_id: customerId,
        });
        if (!contacts.ok) return toast(contacts.message, "error");
        const existing = (contacts.data as any[])
          .map(
            (contact) =>
              `${contact.is_primary ? "主联系人 " : ""}${contact.name} ${contact.phone}${contact.relation ? `（${contact.relation}）` : ""}`
          )
          .join("；");
        openDialog(
          existing ? `联系人：${existing}` : "新增联系人",
          `
          <label>姓名<input name="name" required /></label>
          <label>电话<input name="phone" required /></label>
          <label>关系<input name="relation" placeholder="配偶/父母/同事" /></label>
          <label><span><input name="is_primary" type="checkbox" /> 主联系人</span></label>
          <label class="full">备注<input name="remark" /></label>
          `,
          async (fd) => {
            const result = await api("customer.contacts.upsert", {
              customer_id: customerId,
              name: fd.get("name"),
              phone: fd.get("phone"),
              relation: fd.get("relation"),
              is_primary: fd.get("is_primary") === "on",
              remark: fd.get("remark"),
            });
            toast(result.ok ? "联系人已保存" : result.message, result.ok ? "ok" : "error");
          }
        );
      })
    );
    list.querySelectorAll("[data-merge]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const sourceId = (btn as HTMLElement).dataset.merge!;
        const source = rows.find((customer) => customer.id === sourceId);
        const options = rows
          .filter(
            (customer) =>
              customer.id !== sourceId && customer.store_id === source?.store_id
          )
          .map((customer) => `<option value="${customer.id}">${customer.name} · ${customer.phone}</option>`)
          .join("");
        openDialog(
          "合并客源（源客源将失效）",
          `
          <label class="full">保留目标客源<select name="target_id">${options}</select></label>
          <label class="full">合并原因<input name="reason" required /></label>
          `,
          async (fd) => {
            const result = await api("customer.merge", {
              source_id: sourceId,
              target_id: fd.get("target_id"),
              reason: fd.get("reason"),
            });
            toast(result.ok ? "客源已合并" : result.message, result.ok ? "ok" : "error");
          }
        );
      })
    );
    list.querySelectorAll("[data-claim]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const r = await api("customer.claim", { id: (btn as HTMLElement).dataset.claim });
        toast(r.ok ? "已认领" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      })
    );
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    openDialog(
      "新建客源",
      `
      <label>姓名<input name="name" required /></label>
      <label>电话<input name="phone" required /></label>
      <label>意图<select name="intent"><option value="buy">求购</option><option value="rent">求租</option></select></label>
      <label>等级<select name="level"><option>A</option><option selected>B</option><option>C</option></select></label>
      <label>预算下限<input name="budget_min" type="number" step="0.01" /></label>
      <label>预算上限<input name="budget_max" type="number" step="0.01" /></label>
      <label><span><input name="is_confidential" type="checkbox" /> 保密客</span></label>
      <label class="full">需求<textarea name="need" rows="3"></textarea></label>
      `,
      async (fd) => {
        const res = await api("customer.create", {
          name: fd.get("name"),
          phone: fd.get("phone"),
          intent: fd.get("intent"),
          level: fd.get("level"),
          budget_min: fd.get("budget_min") ? Number(fd.get("budget_min")) : null,
          budget_max: fd.get("budget_max") ? Number(fd.get("budget_max")) : null,
          is_confidential: fd.get("is_confidential") === "on",
          need: fd.get("need"),
        });
        if (res.ok && (res.data as any).duplicate_hint) {
          toast(`已创建，但电话可能重复：${(res.data as any).duplicate_hint.name}`, "warn");
        } else {
          toast(res.ok ? "客源已创建" : res.message, res.ok ? "ok" : "error");
        }
      }
    );
  });
  main.querySelectorAll("[data-f]").forEach((input) => input.addEventListener("change", draw));
  main.querySelector("[data-f=keyword]")!.addEventListener("input", draw);
  const poolSettings = main.querySelector("[data-pool-settings]");
  if (poolSettings) {
    poolSettings.addEventListener("click", async () => {
      const current = await api("customer.publicPool.settings");
      if (!current.ok) return toast(current.message, "error");
      const value = prompt(
        "多少天未跟进自动掉公？输入 0 表示关闭",
        String((current.data as any).public_pool_days)
      );
      if (value == null) return;
      const result = await api("customer.publicPool.update", {
        public_pool_days: Number(value),
      });
      toast(
        result.ok
          ? Number(value) > 0
            ? `已设置 ${value} 天未跟进掉公`
            : "自动掉公已关闭"
          : result.message,
        result.ok ? "ok" : "error"
      );
    });
  }
  const runPool = main.querySelector("[data-run-pool]");
  if (runPool) {
    runPool.addEventListener("click", async () => {
      const result = await api("customer.publicPool.run");
      if (!result.ok) return toast(result.message, "error");
      const data = result.data as any;
      toast(
        data.enabled ? `掉公执行完成，共转入 ${data.moved} 个客源` : "自动掉公未启用",
        data.enabled ? "ok" : "warn"
      );
      if (data.moved) draw();
    });
  }
  await draw();
}

async function renderFollows(main: HTMLElement) {
  main.innerHTML = `
    <div class="header"><h2>跟进</h2><button class="btn" data-new>写跟进</button></div>
    <div class="filters">
      <select data-f="due"><option value="">全部</option><option value="today">今日待跟进</option><option value="overdue">逾期</option></select>
    </div>
    <div class="list" data-list></div>
  `;
  const houses = await api("house.list", {});
  const customers = await api("customer.list", {});
  const draw = async () => {
    const due = (main.querySelector("[data-f=due]") as HTMLSelectElement).value;
    const r = await api("follow.list", due ? { due } : {});
    const list = main.querySelector("[data-list]")!;
    if (!r.ok) return (list.innerHTML = `<div class="error">${r.message}</div>`);
    const rows = r.data as any[];
    if (!rows.length) return (list.innerHTML = `<div class="empty">暂无跟进</div>`);
    list.innerHTML = rows
      .map(
        (f) => `<div class="row"><div>
        <div><span class="tag">${f.target_type === "house" ? "房" : "客"}</span><strong>${f.content}</strong></div>
        <div class="meta">${f.method || ""} · 下次 ${f.next_follow_at || "未设置"} · ${f.created_at}</div>
      </div></div>`
      )
      .join("");
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    const houseOpts = ((houses.data as any[]) || [])
      .map((h) => `<option value="house:${h.id}">房 · ${h.title}</option>`)
      .join("");
    const cusOpts = ((customers.data as any[]) || [])
      .map((c) => `<option value="customer:${c.id}">客 · ${c.name}</option>`)
      .join("");
    openDialog(
      "写跟进",
      `
      <label class="full">对象<select name="target">${cusOpts}${houseOpts}</select></label>
      <label>方式<select name="method"><option value="call">电话</option><option value="wechat">微信</option><option value="visit">拜访</option><option value="other">其他</option></select></label>
      <label>类型<select name="follow_kind"><option value="normal">普通跟进</option><option value="price_change">改价跟进</option><option value="modification">资料修改</option></select></label>
      <label>下次跟进<input name="next_follow_at" type="datetime-local" /></label>
      <label class="full">内容<textarea name="content" rows="4" required></textarea></label>
      `,
      async (fd) => {
        const [target_type, target_id] = String(fd.get("target")).split(":");
        const next = String(fd.get("next_follow_at") || "");
        const res = await api("follow.create", {
          target_type,
          target_id,
          method: fd.get("method"),
          follow_kind: fd.get("follow_kind"),
          content: fd.get("content"),
          next_follow_at: next ? new Date(next).toISOString() : null,
        });
        toast(res.ok ? "跟进已保存" : res.message, res.ok ? "ok" : "error");
      }
    );
  });
  main.querySelector("[data-f=due]")!.addEventListener("change", draw);
  await draw();
}

async function renderViews(main: HTMLElement) {
  const houses = await api("house.list", { status: "available" });
  const customers = await api("customer.list", {});
  const storeUsers = await api("org.users.store", {});
  main.innerHTML = `
    <div class="header"><h2>带看</h2><button class="btn" data-new>新建带看</button></div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const r = await api("view.list", {});
    const list = main.querySelector("[data-list]")!;
    if (!r.ok) return (list.innerHTML = `<div class="error">${r.message}</div>`);
    const rows = r.data as any[];
    if (!rows.length) return (list.innerHTML = `<div class="empty">暂无带看</div>`);
    const houseMap = Object.fromEntries(((houses.data as any[]) || []).map((h) => [h.id, h.title]));
    const cusMap = Object.fromEntries(((customers.data as any[]) || []).map((c) => [c.id, c.name]));
    list.innerHTML = rows
      .map(
        (v) => `<div class="row"><div>
        <div><span class="tag ${v.status === "done" ? "ok" : ""}">${v.status}</span>
        <span class="tag">${v.feedback}</span>
        <strong>${cusMap[v.customer_id] || v.customer_id} × ${houseMap[v.house_id] || v.house_id}</strong></div>
        <div class="meta">${v.view_at}</div>
      </div>
      <div class="ops">
        ${v.status === "planned" ? `<button class="btn" data-done="${v.id}">完成</button><button class="btn ghost" data-cancel="${v.id}">取消</button>` : ""}
        ${v.status === "done" && ["interested", "deal"].includes(v.feedback) ? `<button class="btn" data-deal="${v.id}" data-h="${v.house_id}" data-c="${v.customer_id}">发起成交</button>` : ""}
      </div></div>`
      )
      .join("");
    list.querySelectorAll("[data-done]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const feedback = prompt("反馈：interested / considering / rejected / deal", "interested");
        if (!feedback) return;
        const r = await api("view.complete", {
          id: (btn as HTMLElement).dataset.done,
          feedback,
          content: "带看完成",
        });
        toast(r.ok ? "已完成" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      })
    );
    list.querySelectorAll("[data-cancel]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const reason = prompt("取消原因");
        if (!reason) return;
        const r = await api("view.cancel", {
          id: (btn as HTMLElement).dataset.cancel,
          reason,
        });
        toast(r.ok ? "已取消" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      })
    );
    list.querySelectorAll("[data-deal]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.tab = "deals";
        state.cache.prefillDeal = {
          view_id: (btn as HTMLElement).dataset.deal,
          house_id: (btn as HTMLElement).dataset.h,
          customer_id: (btn as HTMLElement).dataset.c,
        };
        render();
      })
    );
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    const houseOpts = ((houses.data as any[]) || [])
      .map((h) => `<option value="${h.id}">${h.title}</option>`)
      .join("");
    const cusOpts = ((customers.data as any[]) || [])
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join("");
    const userOpts = ((storeUsers.data as any[]) || [])
      .filter((u) => u.id !== state.user.id)
      .map((u) => `<option value="${u.id}">${u.display_name}</option>`)
      .join("");
    openDialog(
      "新建带看",
      `
      <label>客户<select name="customer_id">${cusOpts}</select></label>
      <label>房源<select name="house_id">${houseOpts}</select></label>
      <label class="full">时间<input name="view_at" type="datetime-local" required /></label>
      <label class="full">陪看人（可多选）<select name="accompany_ids" multiple size="4">${userOpts}</select></label>
      `,
      async (fd) => {
        const res = await api("view.create", {
          customer_id: fd.get("customer_id"),
          house_id: fd.get("house_id"),
          view_at: new Date(String(fd.get("view_at"))).toISOString(),
          accompany_ids: fd.getAll("accompany_ids"),
        });
        toast(res.ok ? "带看已创建" : res.message, res.ok ? "ok" : "error");
      }
    );
  });
  await draw();
}

async function renderDeals(main: HTMLElement) {
  const houses = await api("house.list", {});
  const customers = await api("customer.list", {});
  const desktopShell = (window as any).weilaijia?.shell;
  const prefill = state.cache.prefillDeal || {};
  main.innerHTML = `
    <div class="header"><h2>成交</h2><button class="btn" data-new>新建成交单</button></div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const r = await api("deal.list", {});
    const list = main.querySelector("[data-list]")!;
    if (!r.ok) return (list.innerHTML = `<div class="error">${r.message}</div>`);
    const rows = r.data as any[];
    if (!rows.length) return (list.innerHTML = `<div class="empty">暂无成交单</div>`);
    const checklistEntries = await Promise.all(
      rows.map(async (deal) => [deal.id, await api("deal.documents.list", { deal_id: deal.id })])
    );
    const checklists = new Map(checklistEntries as Array<[string, ApiResult]>);
    const mortgageEntries = await Promise.all(
      rows.map(async (deal) => [deal.id, await api("mortgage.get", { deal_id: deal.id })])
    );
    const mortgages = new Map(mortgageEntries as Array<[string, ApiResult]>);
    list.innerHTML = rows
      .map(
        (d) => `<div class="row"><div>
        <div><span class="tag ${d.status === "approved" ? "ok" : d.status === "rejected" ? "danger" : "warn"}">${d.status}</span>
        <strong>${d.id}</strong> 佣金 ¥${money(d.commission_total)} · 未收 ¥${money(d.unpaid_amount)}</div>
        <div class="meta">房 ${d.house_id} · 客 ${d.customer_id} · 成交价 ${d.contract_price}${d.reject_reason ? ` · 驳回：${d.reject_reason}` : ""}</div>
        ${checklists.get(d.id)?.ok ? `<div class="meta">必传资料 ${(checklists.get(d.id) as any).data.received_count}/${(checklists.get(d.id) as any).data.required_count} ${(checklists.get(d.id) as any).data.complete ? "✓" : ""}</div>` : ""}
        ${mortgages.get(d.id)?.ok && (mortgages.get(d.id) as any).data ? `<div class="meta">按揭 ${(mortgages.get(d.id) as any).data.bank} · ${(mortgages.get(d.id) as any).data.amount} · ${(mortgages.get(d.id) as any).data.status}</div>` : ""}
      </div>
      <div class="ops">
        ${desktopShell ? `<button class="btn ghost" data-files="${d.id}">附件</button>` : ""}
        <button class="btn ghost" data-mortgage="${d.id}">按揭</button>
        ${["pending_approval", "approved"].includes(d.status) ? `<button class="btn ghost" data-sign="${d.id}">签署确认</button>` : ""}
        ${["draft", "rejected"].includes(d.status) ? `<button class="btn" data-submit="${d.id}">提交审批</button>` : ""}
        ${d.status === "pending_approval" && ["admin", "store_manager"].includes(state.user.role) ? `<button class="btn" data-approve="${d.id}">通过</button><button class="btn danger" data-reject="${d.id}">驳回</button>` : ""}
      </div></div>`
      )
      .join("");
    list.querySelectorAll("[data-submit]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const r = await api("deal.submit", { id: (btn as HTMLElement).dataset.submit });
        toast(r.ok ? "已提交" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      })
    );
    list.querySelectorAll("[data-approve]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const r = await api("deal.approve", { id: (btn as HTMLElement).dataset.approve });
        toast(r.ok ? "已审批通过" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      })
    );
    list.querySelectorAll("[data-reject]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const reason = prompt("驳回原因（必填）");
        if (!reason) return;
        const r = await api("deal.reject", {
          id: (btn as HTMLElement).dataset.reject,
          reason,
        });
        toast(r.ok ? "已驳回" : r.message, r.ok ? "ok" : "error");
        if (r.ok) draw();
      })
    );
    list.querySelectorAll("[data-files]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const dealId = (btn as HTMLElement).dataset.files!;
        const existing = await api("attachment.list", {
          parent_type: "deal",
          parent_id: dealId,
        });
        if (!existing.ok) return toast(existing.message, "error");
        const checklist = await api("deal.documents.list", { deal_id: dealId });
        const categories = checklist.ok
          ? (checklist.data as any).items
              .map((item: any) => `${item.category}=${item.label}`)
              .join("，")
          : "";
        const category = prompt(
          `附件分类${categories ? `（${categories}）` : ""}`,
          (checklist.ok && (checklist.data as any).items[0]?.category) || "contract"
        );
        if (!category) return;
        const paths = (await desktopShell.chooseFiles()) as string[];
        for (const localPath of paths) {
          const name = localPath.split(/[\\/]/).pop() || "附件";
          const added = await api("attachment.add", {
            parent_type: "deal",
            parent_id: dealId,
            category,
            name,
            local_path: localPath,
          });
          if (!added.ok) return toast(added.message, "error");
        }
        const refreshed = await api("attachment.list", {
          parent_type: "deal",
          parent_id: dealId,
        });
        const files = refreshed.ok ? (refreshed.data as any[]) : [];
        toast(paths.length ? `已添加 ${paths.length} 个附件，当前共 ${files.length} 个` : `当前共 ${files.length} 个附件`);
        if (paths.length) draw();
      })
    );
    list.querySelectorAll("[data-sign]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const statement = prompt("本地签署确认声明（非 CA 电子签）", "本人确认已核对本成交单内容");
        if (!statement) return;
        const result = await api("contract.sign", {
          deal_id: (btn as HTMLElement).dataset.sign,
          statement,
        });
        toast(result.ok ? "本地签署确认已记录" : result.message, result.ok ? "ok" : "error");
      })
    );
    list.querySelectorAll("[data-mortgage]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const dealId = (btn as HTMLElement).dataset.mortgage!;
        const currentResult = await api("mortgage.get", { deal_id: dealId });
        if (!currentResult.ok) return toast(currentResult.message, "error");
        const current = currentResult.data as any;
        const editable = !current || ["draft", "rejected"].includes(current.status);
        const nextByStatus: Record<string, string[]> = {
          draft: ["draft", "applied", "cancelled"],
          applied: ["applied", "approved", "rejected", "cancelled"],
          rejected: ["rejected", "applied", "cancelled"],
          approved: ["approved", "disbursed", "cancelled"],
          disbursed: ["disbursed"],
          cancelled: ["cancelled"],
        };
        const currentStatus = current?.status || "draft";
        openDialog(
          "贷款按揭",
          `
          <label>贷款银行<input name="bank" value="${current?.bank || ""}" ${editable ? "" : "readonly"} required /></label>
          <label>贷款金额<input name="amount" type="number" step="0.01" value="${current?.amount || ""}" ${editable ? "" : "readonly"} required /></label>
          <label>状态<select name="status">${(nextByStatus[currentStatus] || [currentStatus])
            .map(
              (status) =>
                `<option value="${status}" ${status === currentStatus ? "selected" : ""}>${status}</option>`
            )
            .join("")}</select></label>
          <label class="full">备注<input name="remark" value="${current?.remark || ""}" /></label>
          <label class="full">驳回/取消原因<input name="reason" /></label>
          `,
          async (fd) => {
            if (editable) {
              const saved = await api("mortgage.upsert", {
                deal_id: dealId,
                bank: fd.get("bank"),
                amount: Number(fd.get("amount")),
                remark: fd.get("remark"),
              });
              if (!saved.ok) return toast(saved.message, "error");
            }
            const status = String(fd.get("status"));
            if (status !== currentStatus) {
              const changed = await api("mortgage.status", {
                deal_id: dealId,
                status,
                reason: fd.get("reason"),
              });
              if (!changed.ok) return toast(changed.message, "error");
            }
            toast("按揭信息已更新");
            draw();
          }
        );
      })
    );
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    const houseOpts = ((houses.data as any[]) || [])
      .map(
        (h) =>
          `<option value="${h.id}" ${prefill.house_id === h.id ? "selected" : ""}>${h.title}</option>`
      )
      .join("");
    const cusOpts = ((customers.data as any[]) || [])
      .map(
        (c) =>
          `<option value="${c.id}" ${prefill.customer_id === c.id ? "selected" : ""}>${c.name}</option>`
      )
      .join("");
    openDialog(
      "新建成交单",
      `
      <label>房源<select name="house_id">${houseOpts}</select></label>
      <label>客源<select name="customer_id">${cusOpts}</select></label>
      <label>成交价<input name="contract_price" type="number" step="0.01" required /></label>
      <label>业主佣(元)<input name="commission_owner" type="number" step="0.01" value="20000" /></label>
      <label>客户佣(元)<input name="commission_customer" type="number" step="0.01" value="15000" /></label>
      <label>成交日<input name="deal_date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
      <label>贷款金额<input name="loan_amount" type="number" step="0.01" /></label>
      <label>贷款银行<input name="loan_bank" /></label>
      <label class="full">备注<input name="remark" /></label>
      `,
      async (fd) => {
        const res = await api("deal.create", {
          house_id: fd.get("house_id"),
          customer_id: fd.get("customer_id"),
          view_id: prefill.view_id || null,
          contract_price: Number(fd.get("contract_price")),
          commission_owner: Number(fd.get("commission_owner") || 0),
          commission_customer: Number(fd.get("commission_customer") || 0),
          deal_date: fd.get("deal_date"),
          loan_amount: fd.get("loan_amount") ? Number(fd.get("loan_amount")) : null,
          loan_bank: fd.get("loan_bank"),
          remark: fd.get("remark"),
          agent_ids: [state.user.id],
          split_ratios: { [state.user.id]: 100 },
        });
        state.cache.prefillDeal = null;
        toast(res.ok ? "成交单已创建" : res.message, res.ok ? "ok" : "error");
      }
    );
  });
  await draw();
}

async function renderEarnest(main: HTMLElement) {
  const mayCreate = ["admin", "store_manager", "agent"].includes(state.user.role);
  const houses = mayCreate ? await api("house.list", {}) : ({ ok: true, data: [] } as any);
  const customers = mayCreate
    ? await api("customer.list", {})
    : ({ ok: true, data: [] } as any);
  const deals = await api("deal.list", { status: "approved" });
  main.innerHTML = `
    <div class="header"><h2>意向金</h2>${mayCreate ? `<button class="btn" data-new>登记意向金</button>` : ""}</div>
    <div class="filters">
      <select data-status><option value="">全部状态</option><option value="held">在管</option><option value="applied">已冲抵</option><option value="refunded">已退款</option></select>
    </div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const status = (main.querySelector("[data-status]") as HTMLSelectElement).value;
    const result = await api("earnest.list", status ? { status } : {});
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const rows = result.data as any[];
    list.innerHTML =
      rows
        .map(
          (record) => `<div class="row"><div>
            <div><span class="tag ${record.status === "held" ? "warn" : record.status === "applied" ? "ok" : "danger"}">${record.status === "held" ? "在管" : record.status === "applied" ? "已冲抵" : "已退款"}</span><strong>¥${money(record.amount)}</strong> · ${record.customer_name} × ${record.house_title}</div>
            <div class="meta">${record.method} · ${record.paid_at}${record.refund_reason ? ` · 退款原因 ${record.refund_reason}` : ""}</div>
          </div><div class="ops">
            ${record.status === "held" && ["admin", "finance"].includes(state.user.role) ? `<button class="btn" data-apply="${record.id}">冲抵成交</button><button class="btn danger" data-refund="${record.id}">退款</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无意向金记录</div>`;
    list.querySelectorAll("[data-apply]").forEach((button) =>
      button.addEventListener("click", () => {
        const dealOptions = ((deals.data as any[]) || [])
          .filter((deal) => deal.status === "approved")
          .map(
            (deal) =>
              `<option value="${deal.id}">${deal.id} · 未收 ¥${money(deal.unpaid_amount)}</option>`
          )
          .join("");
        openDialog(
          "意向金冲抵",
          `<label class="full">已审批成交单<select name="deal_id">${dealOptions}</select></label>`,
          async (fd) => {
            const result = await api("earnest.apply", {
              id: (button as HTMLElement).dataset.apply,
              deal_id: fd.get("deal_id"),
            });
            toast(result.ok ? "意向金已冲抵" : result.message, result.ok ? "ok" : "error");
          }
        );
      })
    );
    list.querySelectorAll("[data-refund]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("退款原因");
        if (!reason) return;
        const result = await api("earnest.refund", {
          id: (button as HTMLElement).dataset.refund,
          reason,
        });
        toast(result.ok ? "意向金已退款" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  const createButton = main.querySelector("[data-new]");
  if (createButton) {
    createButton.addEventListener("click", () => {
      const houseOptions = ((houses.data as any[]) || [])
        .map((house) => `<option value="${house.id}">${house.title}</option>`)
        .join("");
      const customerOptions = ((customers.data as any[]) || [])
        .map((customer) => `<option value="${customer.id}">${customer.name}</option>`)
        .join("");
      openDialog(
        "登记意向金",
        `
        <label>客户<select name="customer_id">${customerOptions}</select></label>
        <label>房源<select name="house_id">${houseOptions}</select></label>
        <label>金额<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label>方式<select name="method"><option value="transfer">转账</option><option value="cash">现金</option><option value="other">其他</option></select></label>
        <label class="full">备注<input name="remark" /></label>
        `,
        async (fd) => {
          const result = await api("earnest.create", {
            customer_id: fd.get("customer_id"),
            house_id: fd.get("house_id"),
            amount: Number(fd.get("amount")),
            method: fd.get("method"),
            remark: fd.get("remark"),
          });
          toast(result.ok ? "意向金已登记" : result.message, result.ok ? "ok" : "error");
        }
      );
    });
  }
  const seedButton = main.querySelector("[data-seed]");
  if (seedButton) {
    seedButton.addEventListener("click", () => {
      const options = ((deals.data as any[]) || [])
        .filter((deal) => deal.status === "approved")
        .map((deal) => `<option value="${deal.id}">${deal.id}</option>`)
        .join("");
      openDialog(
        "从模板补齐过户节点",
        `<label class="full">已审批成交<select name="deal_id">${options}</select></label>`,
        async (fd) => {
          const result = await api("transfer.seed", { deal_id: fd.get("deal_id") });
          toast(
            result.ok ? `已补齐 ${(result.data as any).created} 个节点` : result.message,
            result.ok ? "ok" : "error"
          );
          if (result.ok) draw();
        }
      );
    });
  }
  main.querySelector("[data-status]")!.addEventListener("change", draw);
  await draw();
}

async function renderTransfer(main: HTMLElement) {
  const deals = await api("deal.list", { status: "approved" });
  const canCreate = ["admin", "store_manager"].includes(state.user.role);
  main.innerHTML = `
    <div class="header"><h2>过户节点</h2>${canCreate ? `<div class="ops"><button class="btn ghost" data-seed>从模板补齐</button><button class="btn" data-new>新增节点</button></div>` : ""}</div>
    <div class="filters">
      <select data-status><option value="">全部状态</option><option value="pending">待办理</option><option value="in_progress">办理中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select>
    </div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const status = (main.querySelector("[data-status]") as HTMLSelectElement).value;
    const result = await api("transfer.list", status ? { status } : {});
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const rows = result.data as any[];
    list.innerHTML =
      rows
        .map(
          (node) => `<div class="row"><div>
            <div><span class="tag ${node.status === "completed" ? "ok" : node.status === "cancelled" ? "danger" : "warn"}">${node.status === "pending" ? "待办理" : node.status === "in_progress" ? "办理中" : node.status === "completed" ? "已完成" : "已取消"}</span><strong>${node.title}</strong> · ${node.node_type}</div>
            <div class="meta">成交单 ${node.deal_id} · 计划 ${node.planned_at || "未设置"} · ${node.assignee_name || "未指派"}${node.remark ? ` · ${node.remark}` : ""}</div>
          </div><div class="ops">
            ${node.status === "pending" ? `<button class="btn ghost" data-start="${node.id}">开始</button>` : ""}
            ${["pending", "in_progress"].includes(node.status) ? `<button class="btn" data-complete="${node.id}">完成</button><button class="btn danger" data-cancel="${node.id}">取消</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无过户节点</div>`;
    list.querySelectorAll("[data-start]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("transfer.status", {
          id: (button as HTMLElement).dataset.start,
          status: "in_progress",
        });
        toast(result.ok ? "节点已开始" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-complete]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("transfer.status", {
          id: (button as HTMLElement).dataset.complete,
          status: "completed",
        });
        toast(result.ok ? "节点已完成" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-cancel]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("取消原因");
        if (!reason) return;
        const result = await api("transfer.status", {
          id: (button as HTMLElement).dataset.cancel,
          status: "cancelled",
          reason,
        });
        toast(result.ok ? "节点已取消" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  const createButton = main.querySelector("[data-new]");
  if (createButton) {
    createButton.addEventListener("click", () => {
      const options = ((deals.data as any[]) || [])
        .filter((deal) => deal.status === "approved")
        .map((deal) => `<option value="${deal.id}">${deal.id}</option>`)
        .join("");
      openDialog(
        "新增过户节点",
        `
        <label class="full">成交单<select name="deal_id">${options}</select></label>
        <label>节点类型<select name="node_type"><option value="contract">合同</option><option value="loan">贷款</option><option value="tax">缴税</option><option value="transfer">过户</option><option value="delivery">交房</option><option value="other">其他</option></select></label>
        <label>节点名称<input name="title" required /></label>
        <label>计划时间<input name="planned_at" type="datetime-local" /></label>
        <label>备注<input name="remark" /></label>
        `,
        async (fd) => {
          const planned = String(fd.get("planned_at") || "");
          const result = await api("transfer.create", {
            deal_id: fd.get("deal_id"),
            node_type: fd.get("node_type"),
            title: fd.get("title"),
            planned_at: planned ? new Date(planned).toISOString() : null,
            remark: fd.get("remark"),
          });
          toast(result.ok ? "过户节点已创建" : result.message, result.ok ? "ok" : "error");
        }
      );
    });
  }
  main.querySelector("[data-status]")!.addEventListener("change", draw);
  await draw();
}

async function renderPayments(main: HTMLElement) {
  const deals = await api("deal.list", { status: "approved" });
  const canCashier = ["admin", "finance"].includes(state.user.role);
  const statusLabel: Record<string, string> = {
    pending: "待出纳确认",
    confirmed: "已到账",
    rejected: "已驳回",
  };
  main.innerHTML = `
    <div class="header"><h2>收款</h2>
      ${canCashier ? `<button class="btn" data-new>登记收款</button>` : ""}
    </div>
    <div class="list" data-list></div>
  `;
  const r = await api("payment.list", {});
  const list = main.querySelector("[data-list]")!;
  if (!r.ok) list.innerHTML = `<div class="error">${r.message}</div>`;
  else if (!(r.data as any[]).length) list.innerHTML = `<div class="empty">暂无收款</div>`;
  else {
    list.innerHTML = (r.data as any[])
      .map(
        (p) => `<div class="row"><div>
        <div>
          <span class="tag ${p.status === "confirmed" ? "ok" : p.status === "rejected" ? "danger" : "warn"}">${p.direction === "out" ? "退款" : statusLabel[p.status] || p.status}</span>
          <strong>¥${money(p.amount)}</strong> · ${p.method} · ${p.payer_side}
        </div>
        <div class="meta">成交单 ${p.deal_id} · ${p.paid_at}${p.reject_reason ? ` · 驳回：${escapeHtml(p.reject_reason)}` : ""}</div>
      </div><div class="ops">
        ${p.status === "pending" && p.direction !== "out" && canCashier ? `<button class="btn" data-confirm-payment="${p.id}">确认到账</button><button class="btn danger" data-reject-payment="${p.id}">驳回</button>` : ""}
        ${p.status === "confirmed" && p.direction !== "out" && canCashier ? `<button class="btn danger" data-refund-payment="${p.deal_id}">登记退款</button>` : ""}
      </div></div>`
      )
      .join("");
    list.querySelectorAll("[data-confirm-payment]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("payment.confirm", {
          id: (button as HTMLElement).dataset.confirmPayment,
        });
        if (result.ok && (result.data as any).warning) toast((result.data as any).warning, "warn");
        else toast(result.ok ? "已确认到账" : result.message, result.ok ? "ok" : "error");
        if (result.ok) render();
      })
    );
    list.querySelectorAll("[data-reject-payment]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("驳回原因（必填）");
        if (!reason) return;
        const result = await api("payment.reject", {
          id: (button as HTMLElement).dataset.rejectPayment,
          reason,
        });
        toast(result.ok ? "收款已驳回" : result.message, result.ok ? "ok" : "error");
        if (result.ok) render();
      })
    );
    list.querySelectorAll("[data-refund-payment]").forEach((button) =>
      button.addEventListener("click", async () => {
        const amount = prompt("退款金额");
        const reason = prompt("退款原因");
        if (!amount || !reason) return;
        const result = await api("payment.refund", {
          deal_id: (button as HTMLElement).dataset.refundPayment,
          amount: Number(amount),
          reason,
          method: "transfer",
        });
        toast(result.ok ? "退款已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) render();
      })
    );
  }
  const btn = main.querySelector("[data-new]");
  if (btn) {
    btn.addEventListener("click", () => {
      const opts = ((deals.data as any[]) || [])
        .filter((d) => d.status === "approved")
        .map(
          (d) =>
            `<option value="${d.id}">${d.id} 未收¥${money(d.unpaid_amount)}</option>`
        )
        .join("");
      openDialog(
        "登记收款（待出纳确认）",
        `
        <label class="full">成交单<select name="deal_id">${opts}</select></label>
        <label>金额<input name="amount" type="number" step="0.01" required /></label>
        <label>方式<select name="method"><option value="transfer">转账</option><option value="cash">现金</option><option value="other">其他</option></select></label>
        <label>付款方<select name="payer_side"><option value="customer">客户</option><option value="owner">业主</option><option value="other">其他</option></select></label>
        `,
        async (fd) => {
          const res = await api("payment.create", {
            deal_id: fd.get("deal_id"),
            amount: Number(fd.get("amount")),
            method: fd.get("method"),
            payer_side: fd.get("payer_side"),
          });
          if (res.ok && (res.data as any).warning) toast((res.data as any).warning, "warn");
          else toast(res.ok ? "收款已登记，待出纳确认" : res.message, res.ok ? "ok" : "error");
        }
      );
    });
  }
}

async function renderCommissions(main: HTMLElement) {
  const r = await api("commission.list");
  main.innerHTML = `<div class="header"><h2>提成</h2></div><div class="list" data-list></div>`;
  const list = main.querySelector("[data-list]")!;
  if (!r.ok) return (list.innerHTML = `<div class="error">${r.message}</div>`);
  const rows = r.data as any[];
  if (!rows.length) return (list.innerHTML = `<div class="empty">暂无提成</div>`);
  list.innerHTML = rows
    .map(
      (c) => `<div class="row"><div>
      <div><span class="tag ${c.status === "paid" ? "ok" : "warn"}">${c.status}</span>
      <strong>¥${money(c.amount)}</strong> · 占比 ${c.ratio}%</div>
      <div class="meta">成交单 ${c.deal_id} · 用户 ${c.user_id}</div>
    </div>
    <div class="ops">
      ${c.status === "accrued" && ["admin", "finance"].includes(state.user.role) ? `<button class="btn" data-paid="${c.id}">标记已发放</button>` : ""}
    </div></div>`
    )
    .join("");
  list.querySelectorAll("[data-paid]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const r = await api("commission.paid", { id: (btn as HTMLElement).dataset.paid });
      toast(r.ok ? "已标记发放" : r.message, r.ok ? "ok" : "error");
      if (r.ok) render();
    })
  );
}

async function renderReports(main: HTMLElement) {
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const canAnalyze = state.user.role !== "finance";
  main.innerHTML = `
    <div class="header"><h2>经营报表</h2><div class="ops">
      <button class="btn ghost" data-export="deals">成交 CSV</button>
      <button class="btn ghost" data-export="dealHotspots">热点 CSV</button>
      ${canAnalyze ? `<button class="btn ghost" data-export="houses">房源 CSV</button><button class="btn ghost" data-export="customers">客源 CSV</button><button class="btn ghost" data-export="follows">跟进 CSV</button><button class="btn ghost" data-export="views">带看 CSV</button><button class="btn ghost" data-export="houseAttributes">属性 CSV</button><button class="btn ghost" data-export="customerSources">来源 CSV</button>` : ""}
    </div></div>
    <div class="filters"><input data-month type="month" value="${defaultMonth}" /></div>
    <div data-report></div>
  `;
  const listBlock = (title: string, rowsHtml: string) =>
    `<h3>${title}</h3><div class="list">${rowsHtml || `<div class="empty">暂无数据</div>`}</div>`;
  const draw = async () => {
    const month = (main.querySelector("[data-month]") as HTMLInputElement).value;
    const [result, activity, hotspots, attributes, sources] = await Promise.all([
      api("report.business", { month }),
      canAnalyze
        ? api("report.activityStats", { month })
        : Promise.resolve({ ok: false, message: "无权限" } as ApiResult),
      api("report.dealHotspots", { month }),
      canAnalyze
        ? api("report.houseAttributes", {})
        : Promise.resolve({ ok: false, message: "无权限" } as ApiResult),
      canAnalyze
        ? api("report.customerSources", {})
        : Promise.resolve({ ok: false, message: "无权限" } as ApiResult),
    ]);
    const container = main.querySelector("[data-report]")!;
    if (!result.ok) return (container.innerHTML = `<div class="error">${result.message}</div>`);
    const report = result.data as any;
    const hot = hotspots.ok ? (hotspots.data as any) : null;
    const attrs = attributes.ok ? (attributes.data as any) : null;
    const src = sources.ok ? (sources.data as any) : null;
    container.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="n">${report.houses_added}</div><div class="l">新增房源</div></div>
        <div class="stat"><div class="n">${report.customers_added}</div><div class="l">新增客源</div></div>
        <div class="stat"><div class="n">${report.follows_created}</div><div class="l">新增跟进</div></div>
        <div class="stat"><div class="n">${report.views_created}</div><div class="l">带看</div></div>
        <div class="stat"><div class="n">${report.deals_approved}</div><div class="l">审批成交</div></div>
        <div class="stat"><div class="n">${money(report.commission_total)}</div><div class="l">应收佣金</div></div>
        <div class="stat"><div class="n">${money(report.paid_total)}</div><div class="l">已收佣金</div></div>
        <div class="stat"><div class="n">${money(report.unpaid_total)}</div><div class="l">未收佣金</div></div>
      </div>
      <h3>经纪人业绩排行</h3>
      <div class="list">
        ${
          report.rankings.length
            ? report.rankings
                .map(
                  (item: any, index: number) =>
                    `<div class="row"><div><strong>${index + 1}. ${item.display_name}</strong><div class="meta">${item.deal_count} 单 · 归属业绩 ¥${money(item.performance)}</div></div></div>`
                )
                .join("")
            : `<div class="empty">本月暂无审批成交</div>`
        }
      </div>
      ${
        activity.ok
          ? `<h3>跟进与带看排行</h3>
      <div class="stats">
        <div class="stat"><div class="n">${(activity.data as any).follow_count}</div><div class="l">跟进总数</div></div>
        <div class="stat"><div class="n">${(activity.data as any).view_count}</div><div class="l">带看总数</div></div>
        <div class="stat"><div class="n">${(activity.data as any).effective_view_count}</div><div class="l">有效带看</div></div>
      </div>
      <div class="list">${(activity.data as any).rankings
        .map(
          (item: any, index: number) =>
            `<div class="row"><div><strong>${index + 1}. ${item.display_name}</strong><div class="meta">跟进 ${item.follow_count} · 改价 ${item.price_change_count} · 带看 ${item.view_count} · 有效 ${item.effective_view_count}</div></div></div>`
        )
        .join("") || `<div class="empty">本月暂无跟进与带看</div>`}</div>`
          : ""
      }
      ${
        hot
          ? `${listBlock(
              `成交热点 · 小区（${hot.deal_count} 单）`,
              hot.by_community
                .map(
                  (item: any) =>
                    `<div class="row"><div><strong>${escapeHtml(item.community)}</strong><div class="meta">${item.count} 单 · 成交价合计 ¥${money(item.contract_price_total)} · 佣金 ¥${money(item.commission_total)}</div></div></div>`
                )
                .join("")
            )}
      ${listBlock(
        "成交热点 · 总价段",
        hot.by_price_band
          .map(
            (item: any) =>
              `<div class="row"><div><strong>${item.deal_type === "rent" ? "租" : "售"} · ${escapeHtml(item.price_band)}</strong><div class="meta">${item.count} 单</div></div></div>`
          )
          .join("")
      )}
      ${listBlock(
        "成交热点 · 面积段",
        hot.by_area_band
          .map(
            (item: any) =>
              `<div class="row"><div><strong>${escapeHtml(item.area_band)}</strong><div class="meta">${item.count} 单</div></div></div>`
          )
          .join("")
      )}`
          : ""
      }
      ${
        attrs
          ? `${listBlock(
              `盘源属性 · 租售（${attrs.house_count} 套）`,
              attrs.by_deal_type
                .map(
                  (item: any) =>
                    `<div class="row"><div><strong>${item.deal_type === "rent" ? "出租" : "出售"}</strong><div class="meta">${item.count} 套</div></div></div>`
                )
                .join("")
            )}
      ${listBlock(
        "盘源属性 · 物业类型",
        attrs.by_property_type
          .map(
            (item: any) =>
              `<div class="row"><div><strong>${item.deal_type === "rent" ? "租" : "售"} · ${escapeHtml(item.property_type)}</strong><div class="meta">${item.count} 套</div></div></div>`
          )
          .join("")
      )}
      ${listBlock(
        "盘源属性 · 价格段",
        attrs.by_price_band
          .map(
            (item: any) =>
              `<div class="row"><div><strong>${item.deal_type === "rent" ? "租" : "售"} · ${escapeHtml(item.price_band)}</strong><div class="meta">${item.count} 套</div></div></div>`
          )
          .join("")
      )}`
          : ""
      }
      ${
        src
          ? listBlock(
              `客户来源分析（${src.customer_count} 人）`,
              src.by_source
                .map(
                  (item: any) =>
                    `<div class="row"><div><strong>${escapeHtml(item.source)}</strong><div class="meta">${item.count} 人</div></div></div>`
                )
                .join("")
            )
          : ""
      }
    `;
  };
  main.querySelector("[data-month]")!.addEventListener("change", draw);
  main.querySelectorAll("[data-export]").forEach((button) =>
    button.addEventListener("click", async () => {
      const kind = (button as HTMLElement).dataset.export!;
      const month = (main.querySelector("[data-month]") as HTMLInputElement).value;
      const needsMonth = ["deals", "dealHotspots"].includes(kind);
      const result = await api(`report.${kind}Csv`, needsMonth ? { month } : {});
      if (!result.ok) return toast(result.message, "error");
      const file = result.data as any;
      const blob = new Blob([file.content], { type: file.mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast(`已导出 ${file.rows} 条记录`);
    })
  );
  await draw();
}

async function renderNewhome(main: HTMLElement) {
  const canManage = ["admin", "store_manager"].includes(state.user.role);
  const canSettle = ["admin", "finance"].includes(state.user.role);
  const canWriteSales = state.user.role !== "finance";
  const [projects, customers, users, options] = await Promise.all([
    api("newhome.projects.list", {}),
    api("customer.list", {}),
    api("org.users.store", {}),
    api("newhome.options", {}),
  ]);
  main.innerHTML = `
    <div class="header"><h2>新房项目、报备与销售</h2><div class="ops">
      ${canManage ? `<button class="btn ghost" data-expire>刷新过期报备</button><button class="btn ghost" data-project>新建项目</button><button class="btn ghost" data-partner>分销公司</button><button class="btn ghost" data-export-partners>导出分销</button>` : ""}
      ${canWriteSales ? `<button class="btn ghost" data-register>客户报备</button><button class="btn" data-sale>销售报告</button>` : ""}
    </div></div>
    <h3>项目</h3><div class="list" data-projects></div>
    <h3>分销公司</h3><div class="list" data-partners></div>
    <h3>客户报备</h3>
    <div class="filters"><select data-registration-status><option value="">全部状态</option><option value="registered">保护中</option><option value="arrived">已到场</option><option value="sold">已成交</option><option value="expired">已过期</option><option value="invalid">已作废</option></select></div>
    <div class="list" data-registrations></div>
    <h3>销售报告</h3>
    <div class="filters"><select data-sale-status><option value="">全部状态</option><option value="draft">草稿</option><option value="submitted">待审批</option><option value="approved">已审批</option><option value="rejected">已驳回</option><option value="settled">已结算</option><option value="cancelled">已取消</option></select></div>
    <div class="list" data-sales></div>
  `;
  const projectList = main.querySelector("[data-projects]")!;
  projectList.innerHTML =
    projects.ok && (projects.data as any[]).length
      ? (projects.data as any[])
          .map(
            (project) => `<div class="row"><div>
              <div><span class="tag ${project.status === "active" ? "ok" : "warn"}">${project.status === "active" ? "启用" : "停用"}</span><strong>${project.name}</strong></div>
              <div class="meta">${project.address} · ${project.property_type} · 保护 ${project.protection_days} 天${project.contact_name ? ` · 对接 ${project.contact_name}` : ""}</div>
            </div></div>`
          )
          .join("")
      : `<div class="empty">暂无新房项目</div>`;
  const drawPartners = async () => {
    const result = await api("newhome.distribution.list", {});
    const list = main.querySelector("[data-partners]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (partner) => `<div class="row"><div>
            <div><span class="tag ${partner.status === "active" ? "ok" : "warn"}">${partner.status === "active" ? "启用" : "停用"}</span><strong>${partner.name}</strong></div>
            <div class="meta">${partner.contact_name || "未填联系人"}${partner.contact_phone ? ` · ${partner.contact_phone}` : ""}${partner.address ? ` · ${partner.address}` : ""}</div>
          </div><div class="ops">
            ${canManage ? `<button class="btn ghost" data-partner-toggle="${partner.id}" data-status="${partner.status === "active" ? "inactive" : "active"}">${partner.status === "active" ? "停用" : "恢复"}</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无分销公司</div>`;
    list.querySelectorAll("[data-partner-toggle]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("newhome.distribution.status", {
          id: (button as HTMLElement).dataset.partnerToggle,
          status: (button as HTMLElement).dataset.status,
        });
        toast(updated.ok ? "分销公司状态已更新" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawPartners();
      })
    );
  };
  const drawRegistrations = async () => {
    const status = (main.querySelector("[data-registration-status]") as HTMLSelectElement).value;
    const result = await api(
      "newhome.registrations.list",
      status ? { status } : {}
    );
    const list = main.querySelector("[data-registrations]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (record) => `<div class="row"><div>
            <div><span class="tag ${record.status === "arrived" || record.status === "sold" ? "ok" : record.status === "invalid" || record.status === "expired" ? "danger" : "warn"}">${record.status}</span><strong>${record.customer_name}</strong> · ${record.project_name}</div>
            <div class="meta">${record.customer_phone} · 经纪人 ${record.agent_name} · 保护至 ${record.protect_until.slice(0, 10)}${record.arrival_note ? ` · 到场：${record.arrival_note}` : ""}${record.invalid_reason ? ` · 作废：${record.invalid_reason}` : ""}</div>
          </div><div class="ops">
            ${record.status === "registered" ? `<button class="btn" data-arrival="${record.id}">确认到场</button><button class="btn danger" data-invalidate="${record.id}">作废</button>` : ""}
            ${record.status === "arrived" ? `<button class="btn danger" data-invalidate="${record.id}">作废</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无客户报备</div>`;
    list.querySelectorAll("[data-arrival]").forEach((button) =>
      button.addEventListener("click", async () => {
        const note = prompt("到场说明");
        if (!note) return;
        const updated = await api("newhome.registrations.arrival", {
          id: (button as HTMLElement).dataset.arrival,
          arrival_note: note,
        });
        toast(updated.ok ? "到场已确认" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) {
          drawRegistrations();
          drawSales();
        }
      })
    );
    list.querySelectorAll("[data-invalidate]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("作废原因");
        if (!reason) return;
        const updated = await api("newhome.registrations.invalidate", {
          id: (button as HTMLElement).dataset.invalidate,
          reason,
        });
        toast(updated.ok ? "报备已作废" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawRegistrations();
      })
    );
  };
  const drawSales = async () => {
    const status = (main.querySelector("[data-sale-status]") as HTMLSelectElement).value;
    const result = await api("newhome.sales.list", status ? { status } : {});
    const list = main.querySelector("[data-sales]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (sale) => `<div class="row"><div>
            <div><span class="tag ${sale.status === "settled" || sale.status === "approved" ? "ok" : sale.status === "rejected" || sale.status === "cancelled" ? "danger" : "warn"}">${sale.status}</span><strong>${sale.customer_name}</strong> · ${sale.project_name} · ${sale.unit_no}</div>
            <div class="meta">网签 ${sale.contract_price}${sale.settlement_amount != null ? ` · 结算 ${sale.settlement_amount}` : ""} · 附件 ${sale.attachment_count}${sale.distribution_company_name ? ` · 分销 ${sale.distribution_company_name}` : ""}${sale.reject_reason ? ` · ${sale.reject_reason}` : ""}</div>
          </div><div class="ops">
            ${["draft", "rejected"].includes(sale.status) && canWriteSales ? `<button class="btn ghost" data-sale-attach="${sale.id}">上传合同</button><button class="btn" data-sale-submit="${sale.id}">提交</button><button class="btn danger" data-sale-cancel="${sale.id}">取消</button>` : ""}
            ${sale.status === "submitted" && canManage ? `<button class="btn" data-sale-approve="${sale.id}">审批</button><button class="btn danger" data-sale-reject="${sale.id}">驳回</button>` : ""}
            ${sale.status === "approved" && canSettle ? `<button class="btn" data-sale-settle="${sale.id}">登记结算</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无销售报告</div>`;
    list.querySelectorAll("[data-sale-attach]").forEach((button) =>
      button.addEventListener("click", async () => {
        const localPath = prompt("本地合同扫描件路径");
        if (!localPath) return;
        const uploaded = await api("attachment.add", {
          parent_type: "newhome_sales_report",
          parent_id: (button as HTMLElement).dataset.saleAttach,
          category: "contract_scan",
          name: "网签合同.pdf",
          local_path: localPath,
        });
        toast(uploaded.ok ? "合同已上传" : uploaded.message, uploaded.ok ? "ok" : "error");
        if (uploaded.ok) drawSales();
      })
    );
    list.querySelectorAll("[data-sale-submit]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("newhome.sales.submit", {
          id: (button as HTMLElement).dataset.saleSubmit,
        });
        toast(updated.ok ? "销售报告已提交" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawSales();
      })
    );
    list.querySelectorAll("[data-sale-approve]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("newhome.sales.approve", {
          id: (button as HTMLElement).dataset.saleApprove,
        });
        toast(updated.ok ? "销售报告已审批" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) {
          drawSales();
          drawRegistrations();
        }
      })
    );
    list.querySelectorAll("[data-sale-reject]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("驳回原因");
        if (!reason) return;
        const updated = await api("newhome.sales.reject", {
          id: (button as HTMLElement).dataset.saleReject,
          reason,
        });
        toast(updated.ok ? "销售报告已驳回" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawSales();
      })
    );
    list.querySelectorAll("[data-sale-settle]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "登记结算",
          `<label>结算金额<input name="settlement_amount" type="number" min="0" step="0.01" required /></label>
           <label class="full">结算说明<input name="settlement_note" required /></label>`,
          async (fd) => {
            const updated = await api("newhome.sales.settle", {
              id: (button as HTMLElement).dataset.saleSettle,
              settlement_amount: Number(fd.get("settlement_amount")),
              settlement_note: fd.get("settlement_note"),
            });
            toast(updated.ok ? "结算已登记" : updated.message, updated.ok ? "ok" : "error");
            if (updated.ok) drawSales();
          }
        )
      )
    );
    list.querySelectorAll("[data-sale-cancel]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("取消原因");
        if (!reason) return;
        const updated = await api("newhome.sales.cancel", {
          id: (button as HTMLElement).dataset.saleCancel,
          reason,
        });
        toast(updated.ok ? "销售报告已取消" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawSales();
      })
    );
  };
  const projectButton = main.querySelector("[data-project]");
  if (projectButton) {
    projectButton.addEventListener("click", () =>
      openDialog(
        "新建新房项目",
        `
        <label>项目名称<input name="name" required /></label>
        <label>物业类型<select name="property_type"><option value="residential">住宅</option><option value="apartment">公寓</option><option value="shop">商铺</option><option value="office">办公</option><option value="other">其他</option></select></label>
        <label class="full">地址<input name="address" required /></label>
        <label>报备保护期（天）<input name="protection_days" type="number" min="1" max="365" value="30" required /></label>
        <label>项目对接人<input name="contact_name" /></label>
        <label>联系电话<input name="contact_phone" /></label>
        <label class="full">佣金规则<input name="commission_rule" /></label>
        `,
        async (fd) => {
          const result = await api("newhome.projects.save", {
            name: fd.get("name"),
            address: fd.get("address"),
            property_type: fd.get("property_type"),
            protection_days: Number(fd.get("protection_days")),
            contact_name: fd.get("contact_name"),
            contact_phone: fd.get("contact_phone"),
            commission_rule: fd.get("commission_rule"),
          });
          toast(result.ok ? "新房项目已创建" : result.message, result.ok ? "ok" : "error");
          if (result.ok) render();
        }
      )
    );
  }
  const partnerButton = main.querySelector("[data-partner]");
  if (partnerButton) {
    partnerButton.addEventListener("click", () =>
      openDialog(
        "新建分销公司",
        `
        <label>公司名称<input name="name" required /></label>
        <label>联系人<input name="contact_name" /></label>
        <label>联系电话<input name="contact_phone" placeholder="11位手机号" /></label>
        <label class="full">地址<input name="address" /></label>
        <label class="full">备注<input name="remark" /></label>
        `,
        async (fd) => {
          const result = await api("newhome.distribution.save", {
            name: fd.get("name"),
            contact_name: fd.get("contact_name"),
            contact_phone: fd.get("contact_phone"),
            address: fd.get("address"),
            remark: fd.get("remark"),
          });
          toast(result.ok ? "分销公司已创建" : result.message, result.ok ? "ok" : "error");
          if (result.ok) drawPartners();
        }
      )
    );
  }
  const exportPartners = main.querySelector("[data-export-partners]");
  if (exportPartners) {
    exportPartners.addEventListener("click", async () => {
      const result = await api("newhome.distribution.export", {});
      if (!result.ok) return toast(result.message, "error");
      toast(`已导出 ${(result.data as any).count} 家分销公司`, "ok");
      console.log((result.data as any).csv);
    });
  }
  const registerButton = main.querySelector("[data-register]");
  if (registerButton) {
    registerButton.addEventListener("click", () => {
      const projectOptions = projects.ok
        ? (projects.data as any[])
            .filter((project) => project.status === "active")
            .map((project) => `<option value="${project.id}">${project.name}</option>`)
            .join("")
        : "";
      const customerOptions = customers.ok
        ? (customers.data as any[])
            .map((customer) => `<option value="${customer.id}">${customer.name}</option>`)
            .join("")
        : "";
      const agentOptions =
        canManage && users.ok
          ? (users.data as any[])
              .filter((employee) => employee.role === "agent")
              .map((employee) => `<option value="${employee.id}">${employee.display_name}</option>`)
              .join("")
          : "";
      openDialog(
        "新房客户报备",
        `
        <label>项目<select name="project_id">${projectOptions}</select></label>
        <label>客户<select name="customer_id">${customerOptions}</select></label>
        ${canManage ? `<label>经纪人<select name="agent_id">${agentOptions}</select></label>` : ""}
        <label>来源<input name="source" /></label>
        <label>项目对接人<input name="contact_name" /></label>
        `,
        async (fd) => {
          const result = await api("newhome.registrations.create", {
            project_id: fd.get("project_id"),
            customer_id: fd.get("customer_id"),
            agent_id: fd.get("agent_id") || null,
            source: fd.get("source"),
            contact_name: fd.get("contact_name"),
          });
          toast(result.ok ? `报备成功，保护至 ${(result.data as any).protect_until.slice(0, 10)}` : result.message, result.ok ? "ok" : "error");
          if (result.ok) drawRegistrations();
        }
      );
    });
  }
  const saleButton = main.querySelector("[data-sale]");
  if (saleButton) {
    saleButton.addEventListener("click", () => {
      const registrationOptions = options.ok
        ? ((options.data as any).registrations || [])
            .map(
              (item: any) =>
                `<option value="${item.id}">${item.customer_name} · ${item.project_name}</option>`
            )
            .join("")
        : "";
      const partnerOptions = options.ok
        ? `<option value="">无</option>${((options.data as any).distribution_companies || [])
            .map((item: any) => `<option value="${item.id}">${item.name}</option>`)
            .join("")}`
        : `<option value="">无</option>`;
      openDialog(
        "新建销售报告",
        `
        <label class="full">已到场报备<select name="registration_id">${registrationOptions}</select></label>
        <label>楼栋<input name="building" /></label>
        <label>房号<input name="unit_no" required /></label>
        <label>面积<input name="area_size" type="number" min="0" step="0.01" /></label>
        <label>网签总价<input name="contract_price" type="number" min="0" step="0.01" required /></label>
        <label>签约日期<input name="signed_at" type="date" required /></label>
        <label>分销公司<select name="distribution_company_id">${partnerOptions}</select></label>
        <label class="full">备注<input name="remark" /></label>
        `,
        async (fd) => {
          const result = await api("newhome.sales.create", {
            registration_id: fd.get("registration_id"),
            building: fd.get("building"),
            unit_no: fd.get("unit_no"),
            area_size: fd.get("area_size"),
            contract_price: Number(fd.get("contract_price")),
            signed_at: fd.get("signed_at"),
            distribution_company_id: fd.get("distribution_company_id") || null,
            remark: fd.get("remark"),
          });
          toast(result.ok ? "销售报告草稿已创建" : result.message, result.ok ? "ok" : "error");
          if (result.ok) drawSales();
        }
      );
    });
  }
  const expireButton = main.querySelector("[data-expire]");
  if (expireButton) {
    expireButton.addEventListener("click", async () => {
      const result = await api("newhome.registrations.expire");
      toast(result.ok ? `已刷新 ${(result.data as any).expired} 条过期报备` : result.message, result.ok ? "ok" : "error");
      if (result.ok) drawRegistrations();
    });
  }
  main.querySelector("[data-registration-status]")!.addEventListener("change", drawRegistrations);
  main.querySelector("[data-sale-status]")!.addEventListener("change", drawSales);
  await Promise.all([drawPartners(), drawRegistrations(), drawSales()]);
}

async function renderOffboarding(main: HTMLElement) {
  const [users, tasks] = await Promise.all([
    api("org.users.store", {}),
    api("offboarding.list", {}),
  ]);
  const employees = users.ok ? (users.data as any[]) : [];
  main.innerHTML = `
    <div class="header"><h2>离职交接</h2><div class="ops">
      <button class="btn ghost" data-preview>资产预览</button>
      <button class="btn" data-start>发起交接</button>
    </div></div>
    <div class="list" data-list></div>
  `;
  const draw = async () => {
    const result = await api("offboarding.list", {});
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (task) => `<div class="row"><div>
            <div><span class="tag ${task.status === "completed" ? "ok" : task.status === "cancelled" ? "danger" : "warn"}">${task.status === "pending" ? "待执行" : task.status === "completed" ? "已完成" : "已取消"}</span><strong>${task.employee_name}</strong> → ${task.target_name}</div>
            <div class="meta">房源 ${task.house_count} · 客源 ${task.customer_count} · 钥匙 ${task.key_count} · 角色 ${task.role_count} · ${task.reason}${task.cancel_reason ? ` · 取消：${task.cancel_reason}` : ""}</div>
          </div><div class="ops">
            ${task.status === "pending" ? `<button class="btn" data-execute="${task.id}">执行交接</button><button class="btn danger" data-cancel-offboarding="${task.id}">取消</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无离职交接任务</div>`;
    list.querySelectorAll("[data-execute]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!confirm("执行后将转交资产并立即停用离职员工账号，是否继续？")) return;
        const result = await api("offboarding.execute", {
          id: (button as HTMLElement).dataset.execute,
        });
        toast(
          result.ok
            ? `交接完成：房 ${(result.data as any).houses}、客 ${(result.data as any).customers}、钥匙 ${(result.data as any).keys}`
            : result.message,
          result.ok ? "ok" : "error"
        );
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-cancel-offboarding]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("取消原因");
        if (!reason) return;
        const result = await api("offboarding.cancel", {
          id: (button as HTMLElement).dataset.cancelOffboarding,
          reason,
        });
        toast(result.ok ? "交接任务已取消" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  const sourceOptions = employees
    .filter((employee) => employee.role !== "admin" && employee.id !== state.user.id)
    .map((employee) => `<option value="${employee.id}">${employee.display_name}（${roleLabel(employee.role)}）</option>`)
    .join("");
  const targetOptions = employees
    .filter((employee) => ["agent", "store_manager"].includes(employee.role))
    .map((employee) => `<option value="${employee.id}">${employee.display_name}</option>`)
    .join("");
  main.querySelector("[data-preview]")!.addEventListener("click", () =>
    openDialog(
      "预览员工待交接资产",
      `<label class="full">员工<select name="user_id">${sourceOptions}</select></label>`,
      async (fd) => {
        const result = await api("offboarding.preview", { user_id: fd.get("user_id") });
        if (!result.ok) return toast(result.message, "error");
        const value = result.data as any;
        toast(
          `房源 ${value.houses.length}、客源 ${value.customers.length}、钥匙 ${value.keys.length}、角色 ${value.roles.length}`,
          "warn"
        );
      }
    )
  );
  main.querySelector("[data-start]")!.addEventListener("click", () =>
    openDialog(
      "发起离职交接",
      `
      <label>离职员工<select name="user_id">${sourceOptions}</select></label>
      <label>接收人<select name="target_user_id">${targetOptions}</select></label>
      <label class="full">离职原因<input name="reason" required /></label>
      `,
      async (fd) => {
        const result = await api("offboarding.start", {
          user_id: fd.get("user_id"),
          target_user_id: fd.get("target_user_id"),
          reason: fd.get("reason"),
        });
        toast(result.ok ? "离职交接任务已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  await draw();
}

const expenseCategories: Record<string, string> = {
  transport: "市内交通",
  travel: "差旅",
  office: "办公用品",
  marketing: "营销推广",
  hospitality: "业务招待",
  other: "其他",
};

async function renderExpenses(main: HTMLElement) {
  const desktopShell = (window as any).weilaijia?.shell;
  main.innerHTML = `
    <div class="header"><h2>费用报销</h2><button class="btn" data-new>新建报销</button></div>
    <div class="filters">
      <select data-status><option value="">全部状态</option><option value="draft">草稿</option><option value="pending">待审批</option><option value="approved">待付款</option><option value="rejected">已驳回</option><option value="paid">已付款</option><option value="cancelled">已取消</option></select>
      <select data-category><option value="">全部类别</option>${Object.entries(expenseCategories).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>
    </div>
    <div class="list" data-list></div>
  `;
  const statusLabel: Record<string, string> = {
    draft: "草稿",
    pending: "待审批",
    approved: "待付款",
    rejected: "已驳回",
    paid: "已付款",
    cancelled: "已取消",
  };
  const draw = async () => {
    const status = (main.querySelector("[data-status]") as HTMLSelectElement).value;
    const category = (main.querySelector("[data-category]") as HTMLSelectElement).value;
    const result = await api("expense.list", {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
    });
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map((expense) => {
          const own = expense.applicant_user_id === state.user.id;
          const canReview =
            expense.status === "pending" &&
            expense.applicant_user_id !== state.user.id &&
            ["admin", "store_manager"].includes(state.user.role);
          const canPay =
            expense.status === "approved" &&
            expense.applicant_user_id !== state.user.id &&
            ["admin", "finance"].includes(state.user.role);
          const canReceipt =
            ["draft", "rejected"].includes(expense.status) &&
            (own || state.user.role === "admin");
          const canVoucher =
            ["approved", "paid"].includes(expense.status) &&
            ["admin", "finance"].includes(state.user.role);
          return `<div class="row"><div>
            <div><span class="tag ${expense.status === "paid" ? "ok" : expense.status === "rejected" || expense.status === "cancelled" ? "danger" : "warn"}">${statusLabel[expense.status] || expense.status}</span><span class="tag">${expenseCategories[expense.category] || expense.category}</span><strong>${expense.title}</strong> · ¥${money(expense.amount)}</div>
            <div class="meta">${expense.applicant_name} · 费用日期 ${expense.expense_date} · 票据 ${expense.receipt_count} · 付款凭证 ${expense.voucher_count}${expense.description ? ` · ${expense.description}` : ""}${expense.reject_reason ? ` · 驳回：${expense.reject_reason}` : ""}${expense.payment_reference ? ` · 流水号：${expense.payment_reference}` : ""}</div>
          </div><div class="ops">
            ${canReceipt ? `<button class="btn ghost" data-expense-file="${expense.id}" data-file-category="expense_receipt">上传票据</button>` : ""}
            ${canVoucher ? `<button class="btn ghost" data-expense-file="${expense.id}" data-file-category="payment_voucher">上传付款凭证</button>` : ""}
            ${own && ["draft", "rejected"].includes(expense.status) ? `<button class="btn" data-submit-expense="${expense.id}">提交</button>` : ""}
            ${canReview ? `<button class="btn" data-review-expense="${expense.id}" data-review-status="approved">通过</button><button class="btn danger" data-review-expense="${expense.id}" data-review-status="rejected">驳回</button>` : ""}
            ${canPay ? `<button class="btn" data-pay-expense="${expense.id}">登记付款</button>` : ""}
            ${own && ["draft", "rejected", "pending"].includes(expense.status) ? `<button class="btn danger" data-cancel-expense="${expense.id}">取消</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无费用报销单</div>`;
    list.querySelectorAll("[data-expense-file]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!desktopShell?.chooseFiles) return toast("请在 Electron 桌面端上传附件", "error");
        const element = button as HTMLElement;
        const paths = (await desktopShell.chooseFiles()) as string[];
        for (const localPath of paths) {
          const added = await api("attachment.add", {
            parent_type: "expense_request",
            parent_id: element.dataset.expenseFile,
            category: element.dataset.fileCategory,
            name: localPath.split(/[\\/]/).pop() || "报销附件",
            local_path: localPath,
          });
          if (!added.ok) return toast(added.message, "error");
        }
        toast(paths.length ? `已上传 ${paths.length} 个附件` : "未选择文件");
        if (paths.length) draw();
      })
    );
    list.querySelectorAll("[data-submit-expense]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("expense.submit", {
          id: (button as HTMLElement).dataset.submitExpense,
        });
        toast(result.ok ? "报销单已提交审批" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-review-expense]").forEach((button) =>
      button.addEventListener("click", async () => {
        const element = button as HTMLElement;
        const rejected = element.dataset.reviewStatus === "rejected";
        const reason = rejected ? prompt("驳回原因") : "";
        if (rejected && !reason) return;
        const result = await api("expense.review", {
          id: element.dataset.reviewExpense,
          status: element.dataset.reviewStatus,
          reason,
        });
        toast(result.ok ? (rejected ? "报销单已驳回" : "报销单已审批") : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-pay-expense]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "登记报销付款",
          `<label>付款方式<select name="payment_method"><option value="bank">银行转账</option><option value="cash">现金</option><option value="other">其他</option></select></label><label>付款流水号<input name="payment_reference" /></label>`,
          async (fd) => {
            const result = await api("expense.pay", {
              id: (button as HTMLElement).dataset.payExpense,
              payment_method: fd.get("payment_method"),
              payment_reference: fd.get("payment_reference"),
            });
            toast(result.ok ? "报销付款已登记" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
    list.querySelectorAll("[data-cancel-expense]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!confirm("确定取消此报销单？")) return;
        const result = await api("expense.cancel", {
          id: (button as HTMLElement).dataset.cancelExpense,
        });
        toast(result.ok ? "报销单已取消" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  main.querySelector("[data-new]")!.addEventListener("click", () =>
    openDialog(
      "新建费用报销",
      `
      <label>报销事由<input name="title" required /></label>
      <label>费用类别<select name="category">${Object.entries(expenseCategories).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
      <label>金额<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>费用日期<input name="expense_date" type="date" required /></label>
      <label class="full">说明<textarea name="description" rows="3"></textarea></label>
      `,
      async (fd) => {
        const result = await api("expense.create", {
          title: fd.get("title"),
          category: fd.get("category"),
          amount: Number(fd.get("amount")),
          expense_date: fd.get("expense_date"),
          description: fd.get("description"),
        });
        toast(result.ok ? "报销草稿已创建，请上传票据后提交" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-status]")!.addEventListener("change", draw);
  main.querySelector("[data-category]")!.addEventListener("change", draw);
  await draw();
}

async function renderAttendanceLeave(main: HTMLElement) {
  const config = await api("attendance.settings.get", {});
  const attendanceStatus: Record<string, string> = {
    normal: "正常",
    late: "迟到",
    early_leave: "早退",
    late_early: "迟到且早退",
  };
  const leaveType: Record<string, string> = {
    annual: "年假",
    sick: "病假",
    personal: "事假",
    other: "其他",
  };
  const leaveStatus: Record<string, string> = {
    pending: "待审批",
    approved: "已通过",
    rejected: "已驳回",
    cancelled: "已取消",
  };
  main.innerHTML = `
    <div class="header"><div><h2>考勤请假</h2><div class="meta">${config.ok ? `工作时间 ${(config.data as any).work_start_time}-${(config.data as any).work_end_time} · 迟到宽限 ${(config.data as any).late_grace_minutes} 分钟` : ""}</div></div><div class="ops">
      <button class="btn" data-clock="in">上班打卡</button>
      <button class="btn ghost" data-clock="out">下班打卡</button>
      <button class="btn" data-new-leave>申请请假</button>
      ${state.user.role === "admin" ? `<button class="btn ghost" data-attendance-settings>考勤设置</button>` : ""}
    </div></div>
    <section><h3>考勤记录</h3><div class="list" data-attendance-list></div></section>
    <section><h3>请假申请</h3><div class="filters"><select data-leave-status><option value="">全部状态</option><option value="pending">待审批</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="cancelled">已取消</option></select></div><div class="list" data-leave-list></div></section>
  `;
  const draw = async () => {
    const leaveFilter = (main.querySelector("[data-leave-status]") as HTMLSelectElement).value;
    const [attendanceResult, leaveResult] = await Promise.all([
      api("attendance.list", {}),
      api("leave.list", leaveFilter ? { status: leaveFilter } : {}),
    ]);
    const attendanceList = main.querySelector("[data-attendance-list]")!;
    attendanceList.innerHTML = attendanceResult.ok
      ? (attendanceResult.data as any[])
          .map(
            (record) => `<div class="row"><div>
              <div><span class="tag ${record.status === "normal" ? "ok" : "warn"}">${attendanceStatus[record.status] || record.status}</span><strong>${record.user_name}</strong> · ${record.work_date}</div>
              <div class="meta">上班 ${record.check_in_at ? new Date(record.check_in_at).toLocaleTimeString("zh-CN") : "未打卡"} · 下班 ${record.check_out_at ? new Date(record.check_out_at).toLocaleTimeString("zh-CN") : "未打卡"}${record.correction_reason ? ` · 修正：${record.correction_reason}` : ""}</div>
            </div><div class="ops">${["admin", "store_manager"].includes(state.user.role) ? `<button class="btn ghost" data-correct-attendance="${record.id}" data-work-date="${record.work_date}" data-check-in="${record.check_in_at || ""}" data-check-out="${record.check_out_at || ""}">修正</button>` : ""}</div></div>`
          )
          .join("") || `<div class="empty">暂无考勤记录</div>`
      : `<div class="error">${attendanceResult.message}</div>`;
    const leaveList = main.querySelector("[data-leave-list]")!;
    leaveList.innerHTML = leaveResult.ok
      ? (leaveResult.data as any[])
          .map((request) => {
            const own = request.applicant_user_id === state.user.id;
            const canReview =
              request.status === "pending" &&
              !own &&
              ["admin", "store_manager"].includes(state.user.role);
            return `<div class="row"><div>
              <div><span class="tag ${request.status === "approved" ? "ok" : request.status === "rejected" || request.status === "cancelled" ? "danger" : "warn"}">${leaveStatus[request.status] || request.status}</span><span class="tag">${leaveType[request.leave_type] || request.leave_type}</span><strong>${request.applicant_name}</strong> · ${request.duration_hours} 小时</div>
              <div class="meta">${new Date(request.start_at).toLocaleString("zh-CN")} 至 ${new Date(request.end_at).toLocaleString("zh-CN")} · ${request.reason}${request.reject_reason ? ` · 驳回：${request.reject_reason}` : ""}</div>
            </div><div class="ops">
              ${canReview ? `<button class="btn" data-review-leave="${request.id}" data-leave-to="approved">通过</button><button class="btn danger" data-review-leave="${request.id}" data-leave-to="rejected">驳回</button>` : ""}
              ${own && request.status === "pending" ? `<button class="btn danger" data-cancel-leave="${request.id}">取消</button>` : ""}
            </div></div>`;
          })
          .join("") || `<div class="empty">暂无请假申请</div>`
      : `<div class="error">${leaveResult.message}</div>`;
    attendanceList.querySelectorAll("[data-correct-attendance]").forEach((button) =>
      button.addEventListener("click", () => {
        const element = button as HTMLElement;
        const localValue = (iso: string | undefined) =>
          iso ? new Date(iso).toISOString().slice(0, 16) : "";
        openDialog(
          "修正考勤",
          `<label>上班时间<input name="check_in_at" type="datetime-local" value="${localValue(element.dataset.checkIn)}" required /></label><label>下班时间<input name="check_out_at" type="datetime-local" value="${localValue(element.dataset.checkOut)}" /></label><label class="full">修正原因<input name="reason" required /></label>`,
          async (fd) => {
            const checkIn = String(fd.get("check_in_at") || "");
            const checkOut = String(fd.get("check_out_at") || "");
            const result = await api("attendance.correct", {
              id: element.dataset.correctAttendance,
              check_in_at: checkIn ? new Date(checkIn).toISOString() : null,
              check_out_at: checkOut ? new Date(checkOut).toISOString() : null,
              reason: fd.get("reason"),
            });
            toast(result.ok ? "考勤已修正" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        );
      })
    );
    leaveList.querySelectorAll("[data-review-leave]").forEach((button) =>
      button.addEventListener("click", async () => {
        const element = button as HTMLElement;
        const rejected = element.dataset.leaveTo === "rejected";
        const reason = rejected ? prompt("驳回原因") : "";
        if (rejected && !reason) return;
        const result = await api("leave.review", {
          id: element.dataset.reviewLeave,
          status: element.dataset.leaveTo,
          reason,
        });
        toast(result.ok ? (rejected ? "请假已驳回" : "请假已通过") : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    leaveList.querySelectorAll("[data-cancel-leave]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("leave.cancel", {
          id: (button as HTMLElement).dataset.cancelLeave,
        });
        toast(result.ok ? "请假申请已取消" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  main.querySelectorAll("[data-clock]").forEach((button) =>
    button.addEventListener("click", async () => {
      const result = await api("attendance.clock", {
        kind: (button as HTMLElement).dataset.clock,
      });
      toast(result.ok ? `${(button as HTMLElement).dataset.clock === "in" ? "上班" : "下班"}打卡成功` : result.message, result.ok ? "ok" : "error");
      if (result.ok) draw();
    })
  );
  main.querySelector("[data-new-leave]")!.addEventListener("click", () =>
    openDialog(
      "申请请假",
      `<label>请假类型<select name="leave_type"><option value="annual">年假</option><option value="sick">病假</option><option value="personal">事假</option><option value="other">其他</option></select></label><label>开始时间<input name="start_at" type="datetime-local" required /></label><label>结束时间<input name="end_at" type="datetime-local" required /></label><label class="full">请假原因<textarea name="reason" rows="3" required></textarea></label>`,
      async (fd) => {
        const start = String(fd.get("start_at") || "");
        const end = String(fd.get("end_at") || "");
        const result = await api("leave.create", {
          leave_type: fd.get("leave_type"),
          start_at: start ? new Date(start).toISOString() : null,
          end_at: end ? new Date(end).toISOString() : null,
          reason: fd.get("reason"),
        });
        toast(result.ok ? "请假申请已提交" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-attendance-settings]")?.addEventListener("click", () => {
    const value = config.ok ? (config.data as any) : {};
    openDialog(
      "考勤设置",
      `<label>上班时间<input name="work_start_time" type="time" value="${value.work_start_time || "09:00"}" /></label><label>下班时间<input name="work_end_time" type="time" value="${value.work_end_time || "18:00"}" /></label><label>迟到宽限（分钟）<input name="late_grace_minutes" type="number" min="0" max="120" value="${value.late_grace_minutes ?? 10}" /></label>`,
      async (fd) => {
        const result = await api("attendance.settings.save", {
          work_start_time: fd.get("work_start_time"),
          work_end_time: fd.get("work_end_time"),
          late_grace_minutes: Number(fd.get("late_grace_minutes")),
        });
        toast(result.ok ? "考勤设置已保存，重新进入页面后显示新设置" : result.message, result.ok ? "ok" : "error");
      }
    );
  });
  main.querySelector("[data-leave-status]")!.addEventListener("change", draw);
  await draw();
}

const cashbookCategories: Record<string, string> = {
  commission: "佣金收入",
  deposit: "押金收入",
  service: "服务收入",
  other_income: "其他收入",
  office: "办公支出",
  marketing: "营销支出",
  salary: "薪酬支出",
  rent: "租金支出",
  tax: "税费支出",
  reimbursement: "报销支出",
  other_expense: "其他支出",
};

async function renderCashbook(main: HTMLElement) {
  const canWrite = ["admin", "finance"].includes(state.user.role);
  const desktopShell = (window as any).weilaijia?.shell;
  const optionsResult = await api("cashbook.options", {});
  const options = optionsResult.ok ? (optionsResult.data as any) : { stores: [], deals: [] };
  const defaultMonth = new Date().toISOString().slice(0, 7);
  main.innerHTML = `
    <div class="header"><h2>简易收支流水</h2><div class="ops">
      <button class="btn ghost" data-cashbook-export>导出 CSV</button>
      ${canWrite ? `<button class="btn" data-new-cashbook>登记收支</button>` : ""}
    </div></div>
    <div class="filters">
      <input data-cashbook-month type="month" value="${defaultMonth}" />
      <select data-cashbook-direction><option value="">全部方向</option><option value="income">收入</option><option value="expense">支出</option></select>
      <select data-cashbook-status><option value="">全部状态</option><option value="confirmed">有效</option><option value="voided">已作废</option></select>
    </div>
    <div class="stats" data-cashbook-summary></div>
    <div class="list" data-cashbook-list></div>
  `;
  const query = () => {
    const month = (main.querySelector("[data-cashbook-month]") as HTMLInputElement).value;
    const direction = (main.querySelector("[data-cashbook-direction]") as HTMLSelectElement).value;
    const status = (main.querySelector("[data-cashbook-status]") as HTMLSelectElement).value;
    const [year, value] = month.split("-").map(Number);
    return {
      start_at: `${month}-01T00:00:00.000Z`,
      end_at: new Date(Date.UTC(year, value, 1) - 1).toISOString(),
      ...(direction ? { direction } : {}),
      ...(status ? { status } : {}),
    };
  };
  const draw = async () => {
    const filter = query();
    const [listResult, summaryResult] = await Promise.all([
      api("cashbook.list", filter),
      api("cashbook.summary", filter),
    ]);
    const summary = main.querySelector("[data-cashbook-summary]")!;
    summary.innerHTML = summaryResult.ok
      ? `<div class="stat"><div class="n">¥${money((summaryResult.data as any).income)}</div><div class="l">收入</div></div><div class="stat"><div class="n">¥${money((summaryResult.data as any).expense)}</div><div class="l">支出</div></div><div class="stat"><div class="n">¥${money((summaryResult.data as any).balance)}</div><div class="l">结余</div></div><div class="stat"><div class="n">${(summaryResult.data as any).count}</div><div class="l">有效笔数</div></div>`
      : `<div class="error">${summaryResult.message}</div>`;
    const list = main.querySelector("[data-cashbook-list]")!;
    if (!listResult.ok) return (list.innerHTML = `<div class="error">${listResult.message}</div>`);
    list.innerHTML =
      (listResult.data as any[])
        .map(
          (entry) => `<div class="row"><div>
            <div><span class="tag ${entry.direction === "income" ? "ok" : "warn"}">${entry.direction === "income" ? "收入" : "支出"}</span><span class="tag ${entry.status === "voided" ? "danger" : "ok"}">${entry.status === "voided" ? "已作废" : "有效"}</span><strong>${cashbookCategories[entry.category] || entry.category}</strong> · ¥${money(entry.amount)}</div>
            <div class="meta">${entry.store_name} · ${new Date(entry.occurred_at).toLocaleString("zh-CN")} · ${entry.payment_method}${entry.counterparty ? ` · ${entry.counterparty}` : ""}${entry.deal_id ? ` · 成交 ${entry.deal_id}` : ""} · 凭证 ${entry.voucher_count}${entry.note ? ` · ${entry.note}` : ""}${entry.void_reason ? ` · 作废：${entry.void_reason}` : ""}</div>
          </div><div class="ops">
            ${canWrite && entry.status === "confirmed" ? `<button class="btn ghost" data-cashbook-voucher="${entry.id}">上传凭证</button><button class="btn danger" data-void-cashbook="${entry.id}">作废</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">本月暂无收支流水</div>`;
    list.querySelectorAll("[data-cashbook-voucher]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!desktopShell?.chooseFiles) return toast("请在 Electron 桌面端上传凭证", "error");
        const paths = (await desktopShell.chooseFiles()) as string[];
        for (const localPath of paths) {
          const result = await api("attachment.add", {
            parent_type: "cashbook_entry",
            parent_id: (button as HTMLElement).dataset.cashbookVoucher,
            category: "cashbook_voucher",
            name: localPath.split(/[\\/]/).pop() || "收支凭证",
            local_path: localPath,
          });
          if (!result.ok) return toast(result.message, "error");
        }
        toast(paths.length ? `已上传 ${paths.length} 个凭证` : "未选择文件");
        if (paths.length) draw();
      })
    );
    list.querySelectorAll("[data-void-cashbook]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("作废原因");
        if (!reason) return;
        const result = await api("cashbook.void", {
          id: (button as HTMLElement).dataset.voidCashbook,
          reason,
        });
        toast(result.ok ? "收支流水已作废" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  main.querySelector("[data-new-cashbook]")?.addEventListener("click", () => {
    const storeOptions = options.stores
      .map((store: any) => `<option value="${store.id}">${store.name}</option>`)
      .join("");
    const dealOptions = options.deals
      .map((deal: any) => `<option value="${deal.id}">${deal.id} · ${deal.deal_date}</option>`)
      .join("");
    const dialog = openDialog(
      "登记简易收支",
      `
      <label>方向<select name="direction"><option value="income">收入</option><option value="expense">支出</option></select></label>
      <label>类别<select name="category"></select></label>
      <label>门店<select name="store_id">${storeOptions}</select></label>
      <label>金额<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>发生时间<input name="occurred_at" type="datetime-local" required /></label>
      <label>收付方式<select name="payment_method"><option value="bank">银行</option><option value="cash">现金</option><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="other">其他</option></select></label>
      <label>往来方<input name="counterparty" /></label>
      <label>关联成交<select name="deal_id"><option value="">无</option>${dealOptions}</select></label>
      <label class="full">备注<textarea name="note" rows="3"></textarea></label>
      `,
      async (fd) => {
        const occurred = String(fd.get("occurred_at") || "");
        const result = await api("cashbook.create", {
          direction: fd.get("direction"),
          category: fd.get("category"),
          store_id: fd.get("store_id"),
          amount: Number(fd.get("amount")),
          occurred_at: occurred ? new Date(occurred).toISOString() : null,
          payment_method: fd.get("payment_method"),
          counterparty: fd.get("counterparty"),
          deal_id: fd.get("deal_id") || null,
          note: fd.get("note"),
        });
        toast(result.ok ? "收支流水已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    );
    const direction = dialog.querySelector('[name="direction"]') as HTMLSelectElement;
    const category = dialog.querySelector('[name="category"]') as HTMLSelectElement;
    const refreshCategories = () => {
      const allowed =
        direction.value === "income"
          ? ["commission", "deposit", "service", "other_income"]
          : ["office", "marketing", "salary", "rent", "tax", "reimbursement", "other_expense"];
      category.innerHTML = allowed
        .map((value) => `<option value="${value}">${cashbookCategories[value]}</option>`)
        .join("");
    };
    direction.addEventListener("change", refreshCategories);
    refreshCategories();
  });
  main.querySelector("[data-cashbook-export]")!.addEventListener("click", async () => {
    const result = await api("cashbook.export", query());
    if (!result.ok) return toast(result.message, "error");
    const file = result.data as any;
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`已导出 ${file.rows} 条收支流水`);
  });
  main.querySelectorAll("[data-cashbook-month], [data-cashbook-direction], [data-cashbook-status]").forEach((input) =>
    input.addEventListener("change", draw)
  );
  await draw();
}

async function renderWorkforce(main: HTMLElement) {
  const isAdmin = state.user.role === "admin";
  const [optionsResult, gradesResult] = await Promise.all([
    api("workforce.options", {}),
    api("workforce.grades.list", {}),
  ]);
  const options = optionsResult.ok
    ? (optionsResult.data as any)
    : { users: [], stores: [], grades: [] };
  const roleNames: Record<string, string> = {
    store_manager: "店长",
    agent: "经纪人",
    finance: "财务",
  };
  main.innerHTML = `
    <div class="header"><h2>岗位职级与员工调动</h2><div class="ops">
      <button class="btn ghost" data-transfer-preview>资产预览</button>
      <button class="btn" data-new-transfer>发起调动</button>
      ${isAdmin ? `<button class="btn ghost" data-new-grade>新建职级</button><button class="btn ghost" data-assign-grade>员工定级</button>` : ""}
    </div></div>
    <section><h3>岗位职级</h3><div class="list" data-grade-list></div></section>
    <section><h3>调动申请</h3><div class="filters"><select data-transfer-status><option value="">全部状态</option><option value="pending">待审批</option><option value="approved">待执行</option><option value="completed">已完成</option><option value="rejected">已驳回</option><option value="cancelled">已取消</option></select></div><div class="list" data-transfer-list></div></section>
  `;
  const gradeList = main.querySelector("[data-grade-list]")!;
  gradeList.innerHTML = gradesResult.ok
    ? (gradesResult.data as any[])
        .map(
          (grade) => `<div class="row"><div><div><span class="tag ${grade.status === "active" ? "ok" : "danger"}">${grade.status === "active" ? "启用" : "停用"}</span><strong>${grade.code} · ${grade.name}</strong></div><div class="meta">级序 ${grade.rank_level} · ${grade.applicable_role ? roleNames[grade.applicable_role] : "全部角色"} · 在岗 ${grade.employee_count} 人${grade.description ? ` · ${grade.description}` : ""}</div></div></div>`
        )
        .join("") || `<div class="empty">暂无岗位职级</div>`
    : `<div class="error">${gradesResult.message}</div>`;
  const employeeOptions = options.users
    .filter((employee: any) => employee.role !== "admin" && employee.id !== state.user.id)
    .map(
      (employee: any) =>
        `<option value="${employee.id}">${employee.display_name}（${roleNames[employee.role] || employee.role}${employee.grade_name ? ` · ${employee.grade_name}` : ""}）</option>`
    )
    .join("");
  const handoverOptions = options.users
    .filter(
      (employee: any) =>
        employee.status === "active" && ["agent", "store_manager"].includes(employee.role)
    )
    .map(
      (employee: any) =>
        `<option value="${employee.id}">${employee.display_name}（${roleNames[employee.role]}）</option>`
    )
    .join("");
  const storeOptions = options.stores
    .map((store: any) => `<option value="${store.id}">${store.name}</option>`)
    .join("");
  const drawTransfers = async () => {
    const status = (main.querySelector("[data-transfer-status]") as HTMLSelectElement).value;
    const result = await api(
      "workforce.transfers.list",
      status ? { status } : {}
    );
    const list = main.querySelector("[data-transfer-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (request) => `<div class="row"><div>
            <div><span class="tag ${request.status === "completed" ? "ok" : request.status === "rejected" || request.status === "cancelled" ? "danger" : "warn"}">${request.status === "pending" ? "待审批" : request.status === "approved" ? "待执行" : request.status === "completed" ? "已完成" : request.status === "rejected" ? "已驳回" : "已取消"}</span><strong>${request.employee_name}</strong> · ${request.from_store_name} → ${request.to_store_name}</div>
            <div class="meta">${roleNames[request.from_role] || request.from_role} → ${roleNames[request.to_role] || request.to_role} · 生效 ${request.effective_date} · 交接 ${request.handover_name} · 房 ${request.house_count}/客 ${request.customer_count}/钥匙 ${request.key_count}/角色 ${request.role_count} · ${request.reason}${request.reject_reason ? ` · 驳回：${request.reject_reason}` : ""}</div>
          </div><div class="ops">
            ${isAdmin && request.status === "pending" ? `<button class="btn" data-transfer-review="${request.id}" data-transfer-to="approved">通过</button><button class="btn danger" data-transfer-review="${request.id}" data-transfer-to="rejected">驳回</button>` : ""}
            ${isAdmin && request.status === "approved" ? `<button class="btn" data-transfer-execute="${request.id}">执行调动</button>` : ""}
            ${request.status === "pending" && (isAdmin || request.created_by === state.user.id) ? `<button class="btn danger" data-transfer-cancel="${request.id}">取消</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无员工调动申请</div>`;
    list.querySelectorAll("[data-transfer-review]").forEach((button) =>
      button.addEventListener("click", async () => {
        const element = button as HTMLElement;
        const rejected = element.dataset.transferTo === "rejected";
        const reason = rejected ? prompt("驳回原因") : "";
        if (rejected && !reason) return;
        const result = await api("workforce.transfers.review", {
          id: element.dataset.transferReview,
          status: element.dataset.transferTo,
          reason,
        });
        toast(result.ok ? (rejected ? "调动已驳回" : "调动已审批") : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawTransfers();
      })
    );
    list.querySelectorAll("[data-transfer-execute]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!confirm("执行后将交接原店资产、切换门店并注销员工现有会话，是否继续？")) return;
        const result = await api("workforce.transfers.execute", {
          id: (button as HTMLElement).dataset.transferExecute,
        });
        toast(result.ok ? "员工调动已生效" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawTransfers();
      })
    );
    list.querySelectorAll("[data-transfer-cancel]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("workforce.transfers.cancel", {
          id: (button as HTMLElement).dataset.transferCancel,
        });
        toast(result.ok ? "调动申请已取消" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawTransfers();
      })
    );
  };
  main.querySelector("[data-transfer-preview]")!.addEventListener("click", () =>
    openDialog(
      "预览调动资产",
      `<label class="full">员工<select name="user_id">${employeeOptions}</select></label>`,
      async (fd) => {
        const result = await api("workforce.transfers.preview", {
          user_id: fd.get("user_id"),
        });
        if (!result.ok) return toast(result.message, "error");
        const value = result.data as any;
        toast(
          `待交接：房源 ${value.houses.length}、客源 ${value.customers.length}、钥匙 ${value.keys.length}、角色 ${value.roles.length}`,
          "warn"
        );
      }
    )
  );
  main.querySelector("[data-new-transfer]")!.addEventListener("click", () =>
    openDialog(
      "发起员工调动",
      `
      <label>调动员工<select name="user_id">${employeeOptions}</select></label>
      <label>目标门店<select name="to_store_id">${storeOptions}</select></label>
      <label>原店交接人<select name="handover_user_id">${handoverOptions}</select></label>
      ${isAdmin ? `<label>目标角色<select name="to_role"><option value="agent">经纪人</option><option value="store_manager">店长</option><option value="finance">财务</option></select></label>` : ""}
      <label>生效日期<input name="effective_date" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
      <label class="full">调动原因<textarea name="reason" rows="3" required></textarea></label>
      `,
      async (fd) => {
        const selected = options.users.find(
          (employee: any) => employee.id === fd.get("user_id")
        );
        const result = await api("workforce.transfers.create", {
          user_id: fd.get("user_id"),
          to_store_id: fd.get("to_store_id"),
          handover_user_id: fd.get("handover_user_id"),
          to_role: isAdmin ? fd.get("to_role") : selected?.role,
          effective_date: fd.get("effective_date"),
          reason: fd.get("reason"),
        });
        toast(result.ok ? "员工调动已发起" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawTransfers();
      }
    )
  );
  main.querySelector("[data-new-grade]")?.addEventListener("click", () =>
    openDialog(
      "新建岗位职级",
      `<label>职级代码<input name="code" required /></label><label>职级名称<input name="name" required /></label><label>级序<input name="rank_level" type="number" min="1" max="99" required /></label><label>适用角色<select name="applicable_role"><option value="">全部</option><option value="agent">经纪人</option><option value="store_manager">店长</option><option value="finance">财务</option></select></label><label class="full">说明<textarea name="description" rows="3"></textarea></label>`,
      async (fd) => {
        const result = await api("workforce.grades.save", {
          code: fd.get("code"),
          name: fd.get("name"),
          rank_level: Number(fd.get("rank_level")),
          applicable_role: fd.get("applicable_role") || null,
          description: fd.get("description"),
        });
        toast(result.ok ? "岗位职级已创建" : result.message, result.ok ? "ok" : "error");
      }
    )
  );
  main.querySelector("[data-assign-grade]")?.addEventListener("click", () =>
    openDialog(
      "员工定级",
      `<label>员工<select name="user_id">${employeeOptions}</select></label><label>岗位职级<select name="job_grade_id">${options.grades.map((grade: any) => `<option value="${grade.id}">${grade.code} · ${grade.name}</option>`).join("")}</select></label><label class="full">定级原因<input name="reason" required /></label>`,
      async (fd) => {
        const result = await api("workforce.grades.assign", {
          user_id: fd.get("user_id"),
          job_grade_id: fd.get("job_grade_id"),
          reason: fd.get("reason"),
        });
        toast(result.ok ? "员工定级已保存" : result.message, result.ok ? "ok" : "error");
      }
    )
  );
  main.querySelector("[data-transfer-status]")!.addEventListener("change", drawTransfers);
  await drawTransfers();
}

async function renderRecruitment(main: HTMLElement) {
  const isAdmin = state.user.role === "admin";
  const desktopShell = (window as any).weilaijia?.shell;
  const optionsResult = await api("recruitment.options", {});
  const options = optionsResult.ok
    ? (optionsResult.data as any)
    : { stores: [], jobs: [] };
  const candidateStatus: Record<string, string> = {
    new: "新候选人",
    screening: "筛选中",
    interview: "待面试",
    offer: "已发 Offer",
    hired: "已入职",
    rejected: "已淘汰",
    withdrawn: "已退出",
  };
  main.innerHTML = `
    <div class="header"><h2>招聘管理</h2><div class="ops">
      <button class="btn ghost" data-new-recruitment-job>新建岗位</button>
      <button class="btn" data-new-candidate>录入候选人</button>
    </div></div>
    <section><h3>招聘岗位</h3><div class="list" data-recruitment-jobs></div></section>
    <section><h3>候选人</h3><div class="filters"><select data-candidate-status><option value="">全部状态</option>${Object.entries(candidateStatus).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div><div class="list" data-candidates></div></section>
  `;
  const draw = async () => {
    const status = (main.querySelector("[data-candidate-status]") as HTMLSelectElement).value;
    const [jobsResult, candidatesResult] = await Promise.all([
      api("recruitment.jobs.list", {}),
      api("recruitment.candidates.list", status ? { status } : {}),
    ]);
    const jobs = main.querySelector("[data-recruitment-jobs]")!;
    jobs.innerHTML = jobsResult.ok
      ? (jobsResult.data as any[])
          .map(
            (job) => `<div class="row"><div>
              <div><span class="tag ${job.status === "open" ? "ok" : "danger"}">${job.status === "open" ? "招聘中" : "已关闭"}</span><strong>${job.title}</strong> · ${roleLabel(job.target_role)}</div>
              <div class="meta">${job.store_name} · 招聘 ${job.headcount} 人 · 候选 ${job.candidate_count} · 已入职 ${job.hired_count}${job.requirements ? ` · ${job.requirements}` : ""}</div>
            </div><div class="ops">${job.status === "open" ? `<button class="btn danger" data-close-job="${job.id}">关闭岗位</button>` : ""}</div></div>`
          )
          .join("") || `<div class="empty">暂无招聘岗位</div>`
      : `<div class="error">${jobsResult.message}</div>`;
    const candidates = main.querySelector("[data-candidates]")!;
    candidates.innerHTML = candidatesResult.ok
      ? (candidatesResult.data as any[])
          .map((candidate) => {
            const active = !["hired", "rejected", "withdrawn"].includes(candidate.status);
            return `<div class="row"><div>
              <div><span class="tag ${candidate.status === "hired" ? "ok" : candidate.status === "rejected" || candidate.status === "withdrawn" ? "danger" : "warn"}">${candidateStatus[candidate.status] || candidate.status}</span><strong>${candidate.name}</strong> · ${candidate.phone} · ${candidate.job_title}</div>
              <div class="meta">${candidate.store_name}${candidate.source ? ` · 来源 ${candidate.source}` : ""} · 简历 ${candidate.resume_count}${candidate.interview_at ? ` · 面试 ${new Date(candidate.interview_at).toLocaleString("zh-CN")}` : ""}${candidate.note ? ` · ${candidate.note}` : ""}${candidate.reject_reason ? ` · 淘汰：${candidate.reject_reason}` : ""}</div>
            </div><div class="ops">
              ${active ? `<button class="btn ghost" data-candidate-resume="${candidate.id}">上传简历</button>` : ""}
              ${candidate.status === "new" ? `<button class="btn" data-candidate-status-id="${candidate.id}" data-candidate-to="screening">开始筛选</button>` : ""}
              ${candidate.status === "screening" ? `<button class="btn" data-interview-candidate="${candidate.id}">安排面试</button>` : ""}
              ${candidate.status === "interview" ? `<button class="btn" data-candidate-status-id="${candidate.id}" data-candidate-to="offer">发 Offer</button>` : ""}
              ${candidate.status === "offer" && isAdmin ? `<button class="btn" data-onboard-candidate="${candidate.id}" data-candidate-name="${candidate.name}">办理入职</button>` : ""}
              ${active ? `<button class="btn danger" data-reject-candidate="${candidate.id}">淘汰</button><button class="btn ghost" data-candidate-status-id="${candidate.id}" data-candidate-to="withdrawn">退出</button>` : ""}
            </div></div>`;
          })
          .join("") || `<div class="empty">暂无候选人</div>`
      : `<div class="error">${candidatesResult.message}</div>`;
    jobs.querySelectorAll("[data-close-job]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!confirm("关闭后不可再录入候选人，是否继续？")) return;
        const result = await api("recruitment.jobs.close", {
          id: (button as HTMLElement).dataset.closeJob,
        });
        toast(result.ok ? "招聘岗位已关闭" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    candidates.querySelectorAll("[data-candidate-resume]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!desktopShell?.chooseFiles) return toast("请在 Electron 桌面端上传简历", "error");
        const paths = (await desktopShell.chooseFiles()) as string[];
        for (const localPath of paths) {
          const result = await api("attachment.add", {
            parent_type: "recruitment_candidate",
            parent_id: (button as HTMLElement).dataset.candidateResume,
            category: "resume",
            name: localPath.split(/[\\/]/).pop() || "候选人简历",
            local_path: localPath,
          });
          if (!result.ok) return toast(result.message, "error");
        }
        toast(paths.length ? `已上传 ${paths.length} 份简历` : "未选择文件");
        if (paths.length) draw();
      })
    );
    candidates.querySelectorAll("[data-candidate-status-id]").forEach((button) =>
      button.addEventListener("click", async () => {
        const element = button as HTMLElement;
        const result = await api("recruitment.candidates.status", {
          id: element.dataset.candidateStatusId,
          status: element.dataset.candidateTo,
        });
        toast(result.ok ? "候选人状态已更新" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    candidates.querySelectorAll("[data-interview-candidate]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "安排面试",
          `<label>面试时间<input name="interview_at" type="datetime-local" required /></label><label class="full">面试说明<input name="note" /></label>`,
          async (fd) => {
            const raw = String(fd.get("interview_at") || "");
            const result = await api("recruitment.candidates.status", {
              id: (button as HTMLElement).dataset.interviewCandidate,
              status: "interview",
              interview_at: raw ? new Date(raw).toISOString() : null,
              note: fd.get("note"),
            });
            toast(result.ok ? "面试已安排" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
    candidates.querySelectorAll("[data-reject-candidate]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("淘汰原因");
        if (!reason) return;
        const result = await api("recruitment.candidates.status", {
          id: (button as HTMLElement).dataset.rejectCandidate,
          status: "rejected",
          reason,
        });
        toast(result.ok ? "候选人已淘汰" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    candidates.querySelectorAll("[data-onboard-candidate]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "候选人办理入职",
          `<label>员工姓名<input name="display_name" value="${(button as HTMLElement).dataset.candidateName || ""}" required /></label><label>登录账号<input name="account" required /></label><label>初始密码<input name="password" type="password" minlength="8" required /></label>`,
          async (fd) => {
            const result = await api("recruitment.candidates.onboard", {
              id: (button as HTMLElement).dataset.onboardCandidate,
              display_name: fd.get("display_name"),
              account: fd.get("account"),
              password: fd.get("password"),
            });
            toast(result.ok ? "候选人已入职并创建员工账号" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
  };
  main.querySelector("[data-new-recruitment-job]")!.addEventListener("click", () =>
    openDialog(
      "新建招聘岗位",
      `<label>岗位名称<input name="title" required /></label><label>招聘门店<select name="store_id">${options.stores.map((store: any) => `<option value="${store.id}">${store.name}</option>`).join("")}</select></label><label>目标角色<select name="target_role">${isAdmin ? `<option value="agent">经纪人</option><option value="store_manager">店长</option><option value="finance">财务</option>` : `<option value="agent">经纪人</option>`}</select></label><label>招聘人数<input name="headcount" type="number" min="1" max="100" value="1" required /></label><label class="full">任职要求<textarea name="requirements" rows="3"></textarea></label>`,
      async (fd) => {
        const result = await api("recruitment.jobs.save", {
          title: fd.get("title"),
          store_id: fd.get("store_id"),
          target_role: fd.get("target_role"),
          headcount: Number(fd.get("headcount")),
          requirements: fd.get("requirements"),
        });
        toast(result.ok ? "招聘岗位已发布" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-new-candidate]")!.addEventListener("click", () =>
    openDialog(
      "录入候选人",
      `<label>招聘岗位<select name="job_id">${options.jobs.map((job: any) => `<option value="${job.id}">${job.title} · ${roleLabel(job.target_role)}</option>`).join("")}</select></label><label>姓名<input name="name" required /></label><label>电话<input name="phone" required /></label><label>来源<input name="source" /></label><label class="full">备注<textarea name="note" rows="3"></textarea></label>`,
      async (fd) => {
        const result = await api("recruitment.candidates.create", {
          job_id: fd.get("job_id"),
          name: fd.get("name"),
          phone: fd.get("phone"),
          source: fd.get("source"),
          note: fd.get("note"),
        });
        toast(result.ok ? "候选人已录入" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-candidate-status]")!.addEventListener("change", draw);
  await draw();
}

async function renderEmployeeContracts(main: HTMLElement) {
  const isAdmin = state.user.role === "admin";
  const desktopShell = (window as any).weilaijia?.shell;
  const optionsResult = await api("employee.contracts.options", {});
  const users = optionsResult.ok ? (optionsResult.data as any).users : [];
  const contractTypes: Record<string, string> = {
    labor: "劳动合同",
    confidentiality: "保密协议",
    noncompete: "竞业协议",
  };
  const statusLabels: Record<string, string> = {
    draft: "草稿",
    active: "生效",
    expired: "已到期",
    terminated: "已终止",
  };
  main.innerHTML = `
    <div class="header"><h2>员工合同</h2><div class="ops">
      ${isAdmin ? `<button class="btn ghost" data-expire-contracts>刷新到期</button><button class="btn" data-new-employee-contract>登记合同</button>` : ""}
    </div></div>
    <div class="filters"><select data-contract-status><option value="">全部状态</option>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
    <div class="list" data-employee-contract-list></div>
  `;
  const draw = async () => {
    const status = (main.querySelector("[data-contract-status]") as HTMLSelectElement).value;
    const result = await api("employee.contracts.list", status ? { status } : {});
    const list = main.querySelector("[data-employee-contract-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map((contract) => {
          const own = contract.user_id === state.user.id;
          const canSignedUpload =
            contract.status === "draft" && (isAdmin || own);
          const canRenewalUpload =
            ["active", "expired"].includes(contract.status) && (isAdmin || own);
          return `<div class="row"><div>
            <div><span class="tag ${contract.status === "active" ? "ok" : contract.status === "draft" ? "warn" : "danger"}">${statusLabels[contract.status] || contract.status}</span><span class="tag">${contractTypes[contract.contract_type] || contract.contract_type}</span><strong>${contract.employee_name}</strong> · ${contract.contract_no}</div>
            <div class="meta">${contract.store_name} · ${contract.start_date} 至 ${contract.end_date}${contract.signed_at ? ` · 签署 ${contract.signed_at}` : " · 未登记签署"}${contract.probation_end_date ? ` · 试用期至 ${contract.probation_end_date}` : ""} · 已签附件 ${contract.signed_attachment_count} · 续签附件 ${contract.renewal_attachment_count}${contract.remark ? ` · ${contract.remark}` : ""}${contract.termination_reason ? ` · 终止：${contract.termination_reason}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-contract-events="${contract.id}">履历</button>
            ${canSignedUpload ? `<button class="btn ghost" data-contract-file="${contract.id}" data-contract-category="signed_contract">上传已签合同</button>` : ""}
            ${canRenewalUpload ? `<button class="btn ghost" data-contract-file="${contract.id}" data-contract-category="contract_renewal">上传续签附件</button>` : ""}
            ${isAdmin && contract.status === "draft" && !contract.signed_at ? `<button class="btn ghost" data-sign-employee-contract="${contract.id}">登记签署</button>` : ""}
            ${isAdmin && contract.status === "draft" ? `<button class="btn" data-activate-contract="${contract.id}">启用</button>` : ""}
            ${isAdmin && ["active", "expired"].includes(contract.status) ? `<button class="btn" data-renew-contract="${contract.id}" data-current-end="${contract.end_date}">续签</button>` : ""}
            ${isAdmin && contract.status === "active" ? `<button class="btn danger" data-terminate-contract="${contract.id}">终止</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无员工合同</div>`;
    list.querySelectorAll("[data-contract-file]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!desktopShell?.chooseFiles) return toast("请在 Electron 桌面端上传合同附件", "error");
        const element = button as HTMLElement;
        const paths = (await desktopShell.chooseFiles()) as string[];
        for (const localPath of paths) {
          const result = await api("attachment.add", {
            parent_type: "employee_contract",
            parent_id: element.dataset.contractFile,
            category: element.dataset.contractCategory,
            name: localPath.split(/[\\/]/).pop() || "员工合同附件",
            local_path: localPath,
          });
          if (!result.ok) return toast(result.message, "error");
        }
        toast(paths.length ? `已上传 ${paths.length} 个合同附件` : "未选择文件");
        if (paths.length) draw();
      })
    );
    list.querySelectorAll("[data-contract-events]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("employee.contracts.events", {
          id: (button as HTMLElement).dataset.contractEvents,
        });
        if (!result.ok) return toast(result.message, "error");
        const labels: Record<string, string> = {
          created: "创建",
          signed: "签署",
          activated: "启用",
          renewed: "续签",
          expired: "到期",
          terminated: "终止",
        };
        openInfoDialog(
          "合同履历",
          (result.data as any[])
            .map(
              (event) => `<div class="row"><div><strong>${labels[event.event_type] || event.event_type}</strong><div class="meta">${event.created_by_name} · ${new Date(event.created_at).toLocaleString("zh-CN")} · ${JSON.stringify(event.details)}</div></div></div>`
            )
            .join("") || `<div class="empty">暂无履历</div>`
        );
      })
    );
    list.querySelectorAll("[data-activate-contract]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("employee.contracts.activate", {
          id: (button as HTMLElement).dataset.activateContract,
        });
        toast(result.ok ? "员工合同已启用" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-sign-employee-contract]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "登记合同签署日期",
          `<label>签署日期<input name="signed_at" type="date" required /></label>`,
          async (fd) => {
            const result = await api("employee.contracts.sign", {
              id: (button as HTMLElement).dataset.signEmployeeContract,
              signed_at: fd.get("signed_at"),
            });
            toast(result.ok ? "合同签署日期已登记" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
    list.querySelectorAll("[data-renew-contract]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "续签员工合同",
          `<label>当前到期日<input value="${(button as HTMLElement).dataset.currentEnd}" disabled /></label><label>新到期日<input name="end_date" type="date" required /></label>`,
          async (fd) => {
            const result = await api("employee.contracts.renew", {
              id: (button as HTMLElement).dataset.renewContract,
              end_date: fd.get("end_date"),
            });
            toast(result.ok ? "员工合同已续签" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
    list.querySelectorAll("[data-terminate-contract]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("合同终止原因");
        if (!reason) return;
        const result = await api("employee.contracts.terminate", {
          id: (button as HTMLElement).dataset.terminateContract,
          reason,
        });
        toast(result.ok ? "员工合同已终止" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  main.querySelector("[data-new-employee-contract]")?.addEventListener("click", () =>
    openDialog(
      "登记员工合同",
      `
      <label>员工<select name="user_id">${users.map((employee: any) => `<option value="${employee.id}">${employee.display_name} · ${roleLabel(employee.role)}</option>`).join("")}</select></label>
      <label>合同类型<select name="contract_type">${Object.entries(contractTypes).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
      <label>合同编号<input name="contract_no" required /></label>
      <label>签署日期<input name="signed_at" type="date" /></label>
      <label>开始日期<input name="start_date" type="date" required /></label>
      <label>结束日期<input name="end_date" type="date" required /></label>
      <label>试用期结束<input name="probation_end_date" type="date" /></label>
      <label class="full">备注<textarea name="remark" rows="3"></textarea></label>
      `,
      async (fd) => {
        const result = await api("employee.contracts.create", {
          user_id: fd.get("user_id"),
          contract_type: fd.get("contract_type"),
          contract_no: fd.get("contract_no"),
          signed_at: fd.get("signed_at") || null,
          start_date: fd.get("start_date"),
          end_date: fd.get("end_date"),
          probation_end_date: fd.get("probation_end_date") || null,
          remark: fd.get("remark"),
        });
        toast(result.ok ? "员工合同草稿已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-expire-contracts]")?.addEventListener("click", async () => {
    const result = await api("employee.contracts.expire", {});
    toast(
      result.ok ? `已刷新，新增到期 ${(result.data as any).expired} 份` : result.message,
      result.ok ? "ok" : "error"
    );
    if (result.ok) draw();
  });
  main.querySelector("[data-contract-status]")!.addEventListener("change", draw);
  await draw();
}

async function renderPayroll(main: HTMLElement) {
  const isAdmin = state.user.role === "admin";
  const isFinance = state.user.role === "finance";
  const optionsResult = await api("payroll.options", {});
  const users = optionsResult.ok ? (optionsResult.data as any).users : [];
  main.innerHTML = `
    <div class="header"><h2>薪酬与工资条</h2><div class="ops">
      ${isAdmin ? `<button class="btn ghost" data-salary-profile>维护薪资档案</button><button class="btn" data-new-payroll>新建工资批次</button>` : ""}
    </div></div>
    <section><h3>${isAdmin || isFinance ? "薪资档案" : "我的薪资档案"}</h3><div class="list" data-salary-profiles></div></section>
    <section><h3>${isAdmin || isFinance ? "工资批次" : "我的工资条"}</h3><div class="list" data-payroll-batches></div></section>
    <section data-payroll-detail></section>
  `;
  const statusLabels: Record<string, string> = {
    draft: "草稿",
    calculated: "已计算",
    approved: "已审批",
    paid: "已发放",
  };
  const drawProfiles = async () => {
    const result = await api("payroll.profiles.list", {});
    const list = main.querySelector("[data-salary-profiles]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (profile) => `<div class="row"><div><div><strong>${profile.display_name}</strong> · ${roleLabel(profile.role)}</div><div class="meta">${profile.store_name} · 基本 ¥${money(profile.base_salary)} · 固定津贴 ¥${money(profile.fixed_allowance)} · 固定扣款 ¥${money(profile.fixed_deduction)} · ${profile.bank_name || "未配置银行"} ${profile.bank_account || ""}</div></div></div>`
        )
        .join("") || `<div class="empty">暂无薪资档案</div>`;
  };
  const showItems = async (batch: any) => {
    const result = await api("payroll.items.list", { batch_id: batch.id });
    const detail = main.querySelector("[data-payroll-detail]")!;
    if (!result.ok) return (detail.innerHTML = `<div class="error">${result.message}</div>`);
    detail.innerHTML = `<h3>${batch.payroll_month} 工资明细</h3><div class="list">${(result.data as any[])
      .map(
        (item) => `<div class="row"><div>
          <div><strong>${item.display_name}</strong> · 实发 ¥${money(item.net_amount)}</div>
          <div class="meta">${item.store_name} · 基本 ${money(item.base_salary)} + 津贴 ${money(item.allowance)} + 奖金 ${money(item.bonus)} - 扣款 ${money(item.deduction)} - 税额 ${money(item.tax)} = 应发 ${money(item.gross_amount)}${item.adjustment_reason ? ` · 调整：${item.adjustment_reason}` : ""}</div>
        </div><div class="ops">${isFinance && batch.status === "calculated" ? `<button class="btn ghost" data-adjust-payroll="${item.id}" data-allowance="${item.allowance}" data-bonus="${item.bonus}" data-deduction="${item.deduction}" data-tax="${item.tax}">调整</button>` : ""}</div></div>`
      )
      .join("") || `<div class="empty">暂无工资明细</div>`}</div>`;
    detail.querySelectorAll("[data-adjust-payroll]").forEach((button) =>
      button.addEventListener("click", () => {
        const element = button as HTMLElement;
        openDialog(
          "调整工资明细",
          `<label>津贴<input name="allowance" type="number" min="0" step="0.01" value="${element.dataset.allowance}" /></label><label>奖金<input name="bonus" type="number" min="0" step="0.01" value="${element.dataset.bonus}" /></label><label>扣款<input name="deduction" type="number" min="0" step="0.01" value="${element.dataset.deduction}" /></label><label>税额<input name="tax" type="number" min="0" step="0.01" value="${element.dataset.tax}" /></label><label class="full">调整原因<input name="reason" required /></label>`,
          async (fd) => {
            const adjusted = await api("payroll.items.adjust", {
              id: element.dataset.adjustPayroll,
              allowance: Number(fd.get("allowance")),
              bonus: Number(fd.get("bonus")),
              deduction: Number(fd.get("deduction")),
              tax: Number(fd.get("tax")),
              reason: fd.get("reason"),
            });
            toast(adjusted.ok ? "工资明细已调整" : adjusted.message, adjusted.ok ? "ok" : "error");
            if (adjusted.ok) {
              await drawBatches();
              await showItems(batch);
            }
          }
        );
      })
    );
  };
  const drawBatches = async () => {
    const result = await api("payroll.batches.list", {});
    const list = main.querySelector("[data-payroll-batches]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (batch) => `<div class="row"><div>
            <div><span class="tag ${batch.status === "paid" ? "ok" : batch.status === "draft" ? "warn" : "ok"}">${statusLabels[batch.status] || batch.status}</span><strong>${batch.payroll_month}</strong> · ${batch.employee_count} 人</div>
            <div class="meta">应发合计 ¥${money(batch.gross_total)} · 实发合计 ¥${money(batch.net_total)}${batch.payment_reference ? ` · 发薪流水 ${batch.payment_reference}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-payroll-items="${batch.id}">明细</button>
            ${isFinance && ["draft", "calculated"].includes(batch.status) ? `<button class="btn" data-calculate-payroll="${batch.id}">计算</button>` : ""}
            ${isAdmin && batch.status === "calculated" ? `<button class="btn" data-approve-payroll="${batch.id}">审批</button>` : ""}
            ${isFinance && batch.status === "approved" ? `<button class="btn" data-pay-payroll="${batch.id}">登记发薪</button>` : ""}
            ${isAdmin || isFinance ? `<button class="btn ghost" data-payroll-events="${batch.id}">履历</button><button class="btn ghost" data-export-payroll="${batch.id}">CSV</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无工资批次</div>`;
    const batches = result.data as any[];
    list.querySelectorAll("[data-payroll-items]").forEach((button) =>
      button.addEventListener("click", () => {
        const batch = batches.find(
          (item) => item.id === (button as HTMLElement).dataset.payrollItems
        );
        if (batch) showItems(batch);
      })
    );
    list.querySelectorAll("[data-calculate-payroll]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!confirm("重新计算会覆盖当前工资调整，是否继续？")) return;
        const result = await api("payroll.batches.calculate", {
          id: (button as HTMLElement).dataset.calculatePayroll,
        });
        toast(result.ok ? `已计算 ${(result.data as any).employees} 人工资` : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawBatches();
      })
    );
    list.querySelectorAll("[data-approve-payroll]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("payroll.batches.approve", {
          id: (button as HTMLElement).dataset.approvePayroll,
        });
        toast(result.ok ? "工资批次已审批发布" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawBatches();
      })
    );
    list.querySelectorAll("[data-pay-payroll]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "登记工资发放",
          `<label>发薪流水号<input name="payment_reference" required /></label>`,
          async (fd) => {
            const result = await api("payroll.batches.pay", {
              id: (button as HTMLElement).dataset.payPayroll,
              payment_reference: fd.get("payment_reference"),
            });
            toast(result.ok ? "工资已登记发放" : result.message, result.ok ? "ok" : "error");
            if (result.ok) drawBatches();
          }
        )
      )
    );
    list.querySelectorAll("[data-payroll-events]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("payroll.events", {
          id: (button as HTMLElement).dataset.payrollEvents,
        });
        if (!result.ok) return toast(result.message, "error");
        openInfoDialog(
          "工资批次履历",
          (result.data as any[])
            .map(
              (event) => `<div class="row"><div><strong>${event.event_type}</strong><div class="meta">${event.created_by_name} · ${new Date(event.created_at).toLocaleString("zh-CN")} · ${JSON.stringify(event.details)}</div></div></div>`
            )
            .join("")
        );
      })
    );
    list.querySelectorAll("[data-export-payroll]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("payroll.export", {
          id: (button as HTMLElement).dataset.exportPayroll,
        });
        if (!result.ok) return toast(result.message, "error");
        const file = result.data as any;
        const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.filename;
        anchor.click();
        URL.revokeObjectURL(url);
        toast(`已导出 ${file.rows} 条工资明细`);
      })
    );
  };
  main.querySelector("[data-salary-profile]")?.addEventListener("click", () =>
    openDialog(
      "维护员工薪资档案",
      `<label>员工<select name="user_id">${users.map((employee: any) => `<option value="${employee.id}">${employee.display_name} · ${roleLabel(employee.role)}</option>`).join("")}</select></label><label>基本工资<input name="base_salary" type="number" min="0" step="0.01" required /></label><label>固定津贴<input name="fixed_allowance" type="number" min="0" step="0.01" value="0" /></label><label>固定扣款<input name="fixed_deduction" type="number" min="0" step="0.01" value="0" /></label><label>发薪银行<input name="bank_name" required /></label><label>银行账号<input name="bank_account" required /></label>`,
      async (fd) => {
        const result = await api("payroll.profiles.save", {
          user_id: fd.get("user_id"),
          base_salary: Number(fd.get("base_salary")),
          fixed_allowance: Number(fd.get("fixed_allowance")),
          fixed_deduction: Number(fd.get("fixed_deduction")),
          bank_name: fd.get("bank_name"),
          bank_account: fd.get("bank_account"),
        });
        toast(result.ok ? "薪资档案已保存" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawProfiles();
      }
    )
  );
  main.querySelector("[data-new-payroll]")?.addEventListener("click", () =>
    openDialog(
      "新建工资批次",
      `<label>工资月份<input name="payroll_month" type="month" required /></label>`,
      async (fd) => {
        const result = await api("payroll.batches.create", {
          payroll_month: fd.get("payroll_month"),
        });
        toast(result.ok ? "工资批次已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawBatches();
      }
    )
  );
  await Promise.all([drawProfiles(), drawBatches()]);
}

async function renderOfficeContent(main: HTMLElement) {
  const canCreate = ["admin", "store_manager"].includes(state.user.role);
  const optionsResult = await api("officeContent.options");
  const stores = optionsResult.ok ? (optionsResult.data as any).stores : [];
  const kindLabels: Record<string, string> = {
    announcement: "公告",
    knowledge: "知识文章",
  };
  const categoryLabels: Record<string, string> = {
    news: "资讯",
    policy: "制度",
    training: "培训",
    process: "流程",
    other: "其他",
  };
  const statusLabels: Record<string, string> = {
    draft: "草稿",
    published: "已发布",
    archived: "已归档",
  };
  main.innerHTML = `
    <div class="header"><div><h2>公告与知识库</h2><div class="meta" data-office-unread></div></div>
      ${canCreate ? `<button class="btn" data-new-office-document>新建文档</button>` : ""}
    </div>
    <div class="filters">
      <select data-office-kind><option value="">全部类型</option><option value="announcement">公告</option><option value="knowledge">知识文章</option></select>
      <select data-office-status><option value="">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select>
    </div>
    <div class="list" data-office-document-list></div>
  `;
  const showAttachments = async (document: any) => {
    const result = await api("attachment.list", {
      parent_type: "office_document",
      parent_id: document.id,
    });
    if (!result.ok) return toast(result.message, "error");
    openInfoDialog(
      `${kindLabels[document.document_kind]}附件`,
      (result.data as any[])
        .map(
          (file) =>
            `<div class="row"><div><strong>${escapeHtml(file.name)}</strong><div class="meta">${money(file.size_bytes)} 字节 · ${new Date(file.created_at).toLocaleString("zh-CN")}</div></div></div>`
        )
        .join("") || `<div class="empty">暂无附件</div>`
    );
  };
  const showVersions = async (document: any) => {
    const result = await api("officeContent.versions", { id: document.id });
    if (!result.ok) return toast(result.message, "error");
    openInfoDialog(
      `${escapeHtml(document.title)} · 版本记录`,
      (result.data as any[])
        .map(
          (version) =>
            `<div class="row"><div><strong>V${version.version_no} · ${escapeHtml(version.title)}</strong><div class="meta">${escapeHtml(version.changed_by_name)} · ${new Date(version.changed_at).toLocaleString("zh-CN")}</div><div>${escapeHtml(version.content).replaceAll("\n", "<br />")}</div></div></div>`
        )
        .join("")
    );
  };
  const openEditor = (document?: any) => {
    const isAdmin = state.user.role === "admin";
    openDialog(
      document ? "修改文档（保存后需重新发布）" : "新建公告或知识文章",
      `
      <label>类型<select name="document_kind" ${document ? "disabled" : ""}>${Object.entries(kindLabels).map(([value, label]) => `<option value="${value}" ${document?.document_kind === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label>分类<select name="category">${Object.entries(categoryLabels).map(([value, label]) => `<option value="${value}" ${document?.category === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      ${
        document
          ? `<label>发布范围<input value="${document.scope_type === "company" ? "全公司" : escapeHtml(document.store_name)}" disabled /></label>`
          : isAdmin
            ? `<label>发布范围<select name="scope_type"><option value="company">全公司</option><option value="store">指定门店</option></select></label><label>指定门店<select name="store_id"><option value="">请选择</option>${stores.map((store: any) => `<option value="${store.id}">${escapeHtml(store.name)}</option>`).join("")}</select></label>`
            : `<label>发布范围<input value="本门店" disabled /></label>`
      }
      <label class="full">标题<input name="title" value="${escapeHtml(document?.title)}" required /></label>
      <label class="full">正文<textarea name="content" rows="9" required>${escapeHtml(document?.content)}</textarea></label>
      <label><input name="is_pinned" type="checkbox" ${document?.is_pinned ? "checked" : ""} /> 置顶显示</label>
      `,
      async (fd) => {
        const result = await api(
          document ? "officeContent.update" : "officeContent.create",
          document
            ? {
                id: document.id,
                title: fd.get("title"),
                content: fd.get("content"),
                category: fd.get("category"),
                is_pinned: fd.get("is_pinned") === "on",
              }
            : {
                document_kind: fd.get("document_kind"),
                scope_type: isAdmin ? fd.get("scope_type") : "store",
                store_id: fd.get("store_id"),
                title: fd.get("title"),
                content: fd.get("content"),
                category: fd.get("category"),
                is_pinned: fd.get("is_pinned") === "on",
              }
        );
        toast(result.ok ? (document ? "文档已保存为新草稿" : "文档草稿已创建") : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    );
  };
  const drawUnread = async () => {
    const result = await api("officeContent.unread");
    if (result.ok) {
      const unread = result.data as any;
      main.querySelector("[data-office-unread]")!.textContent =
        `未读 ${unread.count} · 公告 ${unread.announcements} · 知识 ${unread.knowledge}`;
    }
  };
  const draw = async () => {
    const documentKind = (main.querySelector("[data-office-kind]") as HTMLSelectElement).value;
    const status = (main.querySelector("[data-office-status]") as HTMLSelectElement).value;
    const result = await api("officeContent.list", {
      document_kind: documentKind || undefined,
      status: status || undefined,
    });
    const list = main.querySelector("[data-office-document-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const documents = result.data as any[];
    list.innerHTML =
      documents
        .map((document) => {
          const canManage =
            state.user.role === "admin" ||
            (state.user.role === "store_manager" &&
              document.scope_type === "store" &&
              document.store_id === state.user.store_id);
          return `<div class="row"><div>
            <div>${document.is_pinned ? `<span class="tag warn">置顶</span>` : ""}<span class="tag">${kindLabels[document.document_kind]}</span><span class="tag ${document.status === "published" ? "ok" : document.status === "draft" ? "warn" : ""}">${statusLabels[document.status]}</span><strong>${escapeHtml(document.title)}</strong></div>
            <div class="meta">${categoryLabels[document.category]} · ${document.scope_type === "company" ? "全公司" : escapeHtml(document.store_name)} · V${document.version_no} · ${escapeHtml(document.creator_name)}${document.published_at ? ` · 发布 ${new Date(document.published_at).toLocaleString("zh-CN")}` : ""} · 阅读 ${document.read_count} · 附件 ${document.attachment_count}</div>
            <div>${escapeHtml(document.content).replaceAll("\n", "<br />")}</div>
          </div><div class="ops">
            ${document.status === "published" && !document.is_read ? `<button class="btn" data-read-document="${document.id}">标记已读</button>` : ""}
            <button class="btn ghost" data-document-versions="${document.id}">版本</button>
            <button class="btn ghost" data-document-attachments="${document.id}">附件</button>
            ${canManage && document.status !== "archived" ? `<button class="btn ghost" data-upload-office-document="${document.id}">上传附件</button><button class="btn ghost" data-edit-office-document="${document.id}">修改</button>` : ""}
            ${canManage && document.status === "draft" ? `<button class="btn" data-publish-document="${document.id}">发布</button>` : ""}
            ${canManage && document.status === "published" ? `<button class="btn danger" data-archive-document="${document.id}">归档</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无公告或知识文章</div>`;
    list.querySelectorAll("[data-read-document]").forEach((button) =>
      button.addEventListener("click", async () => {
        const marked = await api("officeContent.read", {
          id: (button as HTMLElement).dataset.readDocument,
        });
        toast(marked.ok ? "已记录阅读回执" : marked.message, marked.ok ? "ok" : "error");
        if (marked.ok) await Promise.all([draw(), drawUnread()]);
      })
    );
    list.querySelectorAll("[data-document-versions]").forEach((button) =>
      button.addEventListener("click", () => {
        const document = documents.find(
          (item) => item.id === (button as HTMLElement).dataset.documentVersions
        );
        if (document) showVersions(document);
      })
    );
    list.querySelectorAll("[data-document-attachments]").forEach((button) =>
      button.addEventListener("click", () => {
        const document = documents.find(
          (item) => item.id === (button as HTMLElement).dataset.documentAttachments
        );
        if (document) showAttachments(document);
      })
    );
    list.querySelectorAll("[data-edit-office-document]").forEach((button) =>
      button.addEventListener("click", () => {
        const document = documents.find(
          (item) => item.id === (button as HTMLElement).dataset.editOfficeDocument
        );
        if (document) openEditor(document);
      })
    );
    list.querySelectorAll("[data-upload-office-document]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!desktopShell?.chooseFiles) return toast("请在 Electron 桌面端上传附件", "error");
        const paths = (await desktopShell.chooseFiles()) as string[];
        for (const localPath of paths) {
          const added = await api("attachment.add", {
            parent_type: "office_document",
            parent_id: (button as HTMLElement).dataset.uploadOfficeDocument,
            category: "office_document",
            name: localPath.split(/[\\/]/).pop() || "办公文档附件",
            local_path: localPath,
          });
          if (!added.ok) return toast(added.message, "error");
        }
        toast(paths.length ? `已上传 ${paths.length} 个附件` : "未选择文件");
        if (paths.length) draw();
      })
    );
    list.querySelectorAll("[data-publish-document]").forEach((button) =>
      button.addEventListener("click", async () => {
        const published = await api("officeContent.publish", {
          id: (button as HTMLElement).dataset.publishDocument,
        });
        toast(published.ok ? "文档已发布" : published.message, published.ok ? "ok" : "error");
        if (published.ok) await Promise.all([draw(), drawUnread()]);
      })
    );
    list.querySelectorAll("[data-archive-document]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!confirm("归档后普通员工将无法继续查看，是否继续？")) return;
        const archived = await api("officeContent.archive", {
          id: (button as HTMLElement).dataset.archiveDocument,
        });
        toast(archived.ok ? "文档已归档" : archived.message, archived.ok ? "ok" : "error");
        if (archived.ok) await Promise.all([draw(), drawUnread()]);
      })
    );
  };
  main.querySelector("[data-new-office-document]")?.addEventListener("click", () => openEditor());
  main.querySelector("[data-office-kind]")!.addEventListener("change", draw);
  main.querySelector("[data-office-status]")!.addEventListener("change", draw);
  await Promise.all([draw(), drawUnread()]);
}

async function renderRental(main: HTMLElement) {
  const isAdmin = state.user.role === "admin";
  const isFinance = state.user.role === "finance";
  const isManagerial = isAdmin || state.user.role === "store_manager";
  const optionsResult = await api("rental.options");
  const options = optionsResult.ok
    ? (optionsResult.data as any)
    : { houses: [], users: [], stores: [] };
  const managementLabels: Record<string, string> = {
    rent_out: "委托出租",
    centralized: "集中式托管",
    self_owned: "自有物业",
  };
  const statusLabels: Record<string, string> = {
    draft: "草稿",
    active: "生效",
    expired: "已到期",
    terminated: "已终止",
    pending: "待处理",
    overdue: "已逾期",
    paid: "已收款",
    voided: "已作废",
    in_progress: "处理中",
    completed: "已完成",
    cancelled: "已取消",
  };
  main.innerHTML = `
    <div class="header"><h2>租赁托管</h2><div class="ops">
      ${isManagerial ? `<button class="btn ghost" data-new-rental-property>登记托管物业</button><button class="btn ghost" data-new-rental-lease>登记租约</button>` : ""}
      ${!isFinance ? `<button class="btn" data-new-rental-work>新建维修/保洁工单</button>` : ""}
    </div></div>
    <section><h3>托管物业</h3><div class="list" data-rental-properties></div></section>
    <section><h3>租约</h3><div class="list" data-rental-leases></div></section>
    <section><h3>租金账单</h3><div class="list" data-rental-bills></div></section>
    <section><h3>维修与保洁</h3><div class="list" data-rental-work-orders></div></section>
  `;
  let properties: any[] = [];
  let leases: any[] = [];
  const upload = async (
    parentType: string,
    parentId: string,
    category: string,
    fallbackName: string
  ) => {
    if (!desktopShell?.chooseFiles) return toast("请在 Electron 桌面端上传附件", "error");
    const paths = (await desktopShell.chooseFiles()) as string[];
    for (const localPath of paths) {
      const result = await api("attachment.add", {
        parent_type: parentType,
        parent_id: parentId,
        category,
        name: localPath.split(/[\\/]/).pop() || fallbackName,
        local_path: localPath,
      });
      if (!result.ok) return toast(result.message, "error");
    }
    toast(paths.length ? `已上传 ${paths.length} 个附件` : "未选择文件");
    if (paths.length) drawAll();
  };
  const showEvents = async (entityType: string, entityId: string, title: string) => {
    const result = await api("rental.events", {
      entity_type: entityType,
      entity_id: entityId,
    });
    if (!result.ok) return toast(result.message, "error");
    openInfoDialog(
      `${title}履历`,
      (result.data as any[])
        .map(
          (event) =>
            `<div class="row"><div><strong>${escapeHtml(event.event_type)}</strong><div class="meta">${escapeHtml(event.created_by_name)} · ${new Date(event.created_at).toLocaleString("zh-CN")} · ${escapeHtml(event.details)}</div></div></div>`
        )
        .join("") || `<div class="empty">暂无履历</div>`
    );
  };
  const drawProperties = async () => {
    const result = await api("rental.properties.list");
    const list = main.querySelector("[data-rental-properties]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    properties = result.data as any[];
    list.innerHTML =
      properties
        .map((property) => {
          const canManage =
            isAdmin ||
            (state.user.role === "store_manager" &&
              property.store_id === state.user.store_id);
          return `<div class="row"><div>
            <div><span class="tag ${property.status === "active" ? "ok" : property.status === "draft" ? "warn" : "danger"}">${statusLabels[property.status]}</span><span class="tag">${managementLabels[property.management_type]}</span><strong>${escapeHtml(property.house_title)}</strong></div>
            <div class="meta">${escapeHtml(property.store_name)} · ${escapeHtml(property.community)} ${escapeHtml(property.address)} · 负责人 ${escapeHtml(property.manager_name)} · ${property.start_date} 至 ${property.end_date} · 业主月付款 ¥${money(property.owner_payment)} · 生效租约 ${property.active_lease_count} · 合同 ${property.contract_attachment_count}</div>
          </div><div class="ops">
            <button class="btn ghost" data-rental-events="property:${property.id}:托管物业">履历</button>
            ${canManage && ["draft", "active"].includes(property.status) ? `<button class="btn ghost" data-rental-upload="rental_property:${property.id}:management_contract:托管合同">上传合同</button>` : ""}
            ${canManage && property.status === "draft" ? `<button class="btn" data-activate-rental-property="${property.id}">启用</button>` : ""}
            ${canManage && ["active", "expired"].includes(property.status) ? `<button class="btn danger" data-terminate-rental-property="${property.id}">终止</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无托管物业</div>`;
    list.querySelectorAll("[data-activate-rental-property]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("rental.properties.activate", {
          id: (button as HTMLElement).dataset.activateRentalProperty,
        });
        toast(result.ok ? "托管物业已启用" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      })
    );
    list.querySelectorAll("[data-terminate-rental-property]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("终止托管原因");
        if (!reason) return;
        const result = await api("rental.properties.terminate", {
          id: (button as HTMLElement).dataset.terminateRentalProperty,
          reason,
        });
        toast(result.ok ? "托管已终止" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      })
    );
  };
  const drawLeases = async () => {
    const result = await api("rental.leases.list");
    const list = main.querySelector("[data-rental-leases]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    leases = result.data as any[];
    list.innerHTML =
      leases
        .map((lease) => {
          const canManage =
            isAdmin ||
            (state.user.role === "store_manager" && lease.store_id === state.user.store_id);
          return `<div class="row"><div>
            <div><span class="tag ${lease.status === "active" ? "ok" : lease.status === "draft" ? "warn" : "danger"}">${statusLabels[lease.status]}</span><strong>${escapeHtml(lease.tenant_name)}</strong> · ${escapeHtml(lease.house_title)}</div>
            <div class="meta">${lease.start_date} 至 ${lease.end_date} · 月租 ¥${money(lease.monthly_rent)} · 押金 ¥${money(lease.deposit_amount)} · ${lease.payment_cycle_months} 月一付 · 首期 ${lease.first_due_date} · 账单 ${lease.bill_count} · 租约附件 ${lease.lease_attachment_count}${lease.termination_reason ? ` · 终止：${escapeHtml(lease.termination_reason)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-rental-events="lease:${lease.id}:租约">履历</button>
            ${canManage && lease.status === "draft" ? `<button class="btn ghost" data-rental-upload="rental_lease:${lease.id}:signed_lease:已签租约">上传租约</button><button class="btn" data-activate-rental-lease="${lease.id}">启用</button>` : ""}
            ${canManage && ["active", "expired"].includes(lease.status) ? `<button class="btn danger" data-terminate-rental-lease="${lease.id}">终止</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无租约</div>`;
    list.querySelectorAll("[data-activate-rental-lease]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("rental.leases.activate", {
          id: (button as HTMLElement).dataset.activateRentalLease,
        });
        toast(result.ok ? "租约已启用并生成账单" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      })
    );
    list.querySelectorAll("[data-terminate-rental-lease]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("租约终止原因");
        if (!reason) return;
        const result = await api("rental.leases.terminate", {
          id: (button as HTMLElement).dataset.terminateRentalLease,
          reason,
        });
        toast(result.ok ? "租约已终止，未收账单已作废" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      })
    );
  };
  const drawBills = async () => {
    const result = await api("rental.bills.list");
    const list = main.querySelector("[data-rental-bills]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (bill) => `<div class="row"><div>
            <div><span class="tag ${bill.status === "paid" ? "ok" : bill.status === "overdue" ? "danger" : "warn"}">${statusLabels[bill.status]}</span><strong>${escapeHtml(bill.tenant_name)}</strong> · ${escapeHtml(bill.house_title)} · ¥${money(bill.amount)}</div>
            <div class="meta">账期 ${bill.period_start} 至 ${bill.period_end} · 应收 ${bill.due_date}${bill.paid_at ? ` · 收款 ${new Date(bill.paid_at).toLocaleString("zh-CN")} · ${escapeHtml(bill.payment_method)} ${escapeHtml(bill.payment_reference)}` : ""}${bill.void_reason ? ` · 作废：${escapeHtml(bill.void_reason)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-rental-events="bill:${bill.id}:租金账单">履历</button>
            ${(isAdmin || isFinance) && ["pending", "overdue"].includes(bill.status) ? `<button class="btn" data-pay-rental-bill="${bill.id}" data-bill-amount="${bill.amount}">确认收租</button>` : ""}
            ${isAdmin && ["pending", "overdue"].includes(bill.status) ? `<button class="btn danger" data-void-rental-bill="${bill.id}">作废</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无租金账单</div>`;
    list.querySelectorAll("[data-pay-rental-bill]").forEach((button) =>
      button.addEventListener("click", () => {
        const element = button as HTMLElement;
        openDialog(
          "确认租金收款",
          `<label>收款金额<input name="paid_amount" type="number" value="${element.dataset.billAmount}" readonly /></label><label>收款方式<select name="payment_method"><option value="bank">银行</option><option value="cash">现金</option><option value="other">其他</option></select></label><label class="full">流水号<input name="payment_reference" /></label>`,
          async (fd) => {
            const result = await api("rental.bills.pay", {
              id: element.dataset.payRentalBill,
              paid_amount: Number(fd.get("paid_amount")),
              payment_method: fd.get("payment_method"),
              payment_reference: fd.get("payment_reference"),
            });
            toast(result.ok ? "租金收款已确认" : result.message, result.ok ? "ok" : "error");
            if (result.ok) drawAll();
          }
        );
      })
    );
    list.querySelectorAll("[data-void-rental-bill]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("账单作废原因");
        if (!reason) return;
        const result = await api("rental.bills.void", {
          id: (button as HTMLElement).dataset.voidRentalBill,
          reason,
        });
        toast(result.ok ? "账单已作废" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      })
    );
  };
  const drawWorkOrders = async () => {
    const result = await api("rental.workOrders.list");
    const list = main.querySelector("[data-rental-work-orders]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map((work) => {
          const canManage =
            isAdmin ||
            (state.user.role === "store_manager" && work.store_id === state.user.store_id);
          const canOperate = canManage || work.assignee_user_id === state.user.id;
          return `<div class="row"><div>
            <div><span class="tag ${work.status === "completed" ? "ok" : work.status === "cancelled" ? "danger" : "warn"}">${statusLabels[work.status]}</span><span class="tag">${work.work_type === "maintenance" ? "维修" : "保洁"}</span><strong>${escapeHtml(work.house_title)}</strong></div>
            <div>${escapeHtml(work.description)}</div><div class="meta">负责人 ${escapeHtml(work.assignee_name)} · 预计 ¥${money(work.expected_cost)}${work.actual_cost != null ? ` · 实际 ¥${money(work.actual_cost)}` : ""} · 完工凭证 ${work.evidence_count}${work.completion_note ? ` · ${escapeHtml(work.completion_note)}` : ""}${work.cancel_reason ? ` · 取消：${escapeHtml(work.cancel_reason)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-rental-events="work_order:${work.id}:工单">履历</button>
            ${canOperate && ["pending", "in_progress"].includes(work.status) ? `<button class="btn ghost" data-rental-upload="rental_work_order:${work.id}:work_order_evidence:完工凭证">上传凭证</button>` : ""}
            ${canOperate && work.status === "pending" ? `<button class="btn" data-start-rental-work="${work.id}">开始</button>` : ""}
            ${canOperate && ["pending", "in_progress"].includes(work.status) ? `<button class="btn" data-complete-rental-work="${work.id}">完成</button>` : ""}
            ${canManage && ["pending", "in_progress"].includes(work.status) ? `<button class="btn danger" data-cancel-rental-work="${work.id}">取消</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无维修或保洁工单</div>`;
    list.querySelectorAll("[data-start-rental-work]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("rental.workOrders.status", {
          id: (button as HTMLElement).dataset.startRentalWork,
          status: "in_progress",
        });
        toast(result.ok ? "工单已开始" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      })
    );
    list.querySelectorAll("[data-complete-rental-work]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "完成租赁工单",
          `<label>实际费用<input name="actual_cost" type="number" min="0" step="0.01" value="0" /></label><label class="full">完成说明<input name="completion_note" required /></label>`,
          async (fd) => {
            const result = await api("rental.workOrders.status", {
              id: (button as HTMLElement).dataset.completeRentalWork,
              status: "completed",
              actual_cost: Number(fd.get("actual_cost")),
              completion_note: fd.get("completion_note"),
            });
            toast(result.ok ? "工单已完成" : result.message, result.ok ? "ok" : "error");
            if (result.ok) drawAll();
          }
        )
      )
    );
    list.querySelectorAll("[data-cancel-rental-work]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("工单取消原因");
        if (!reason) return;
        const result = await api("rental.workOrders.cancel", {
          id: (button as HTMLElement).dataset.cancelRentalWork,
          reason,
        });
        toast(result.ok ? "工单已取消" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      })
    );
  };
  const bindCommonActions = () => {
    main.querySelectorAll("[data-rental-upload]").forEach((button) =>
      button.addEventListener("click", () => {
        const [parentType, parentId, category, name] = String(
          (button as HTMLElement).dataset.rentalUpload
        ).split(":");
        upload(parentType, parentId, category, name);
      })
    );
    main.querySelectorAll("[data-rental-events]").forEach((button) =>
      button.addEventListener("click", () => {
        const [entityType, entityId, title] = String(
          (button as HTMLElement).dataset.rentalEvents
        ).split(":");
        showEvents(entityType, entityId, title);
      })
    );
  };
  const drawAll = async () => {
    await Promise.all([drawProperties(), drawLeases(), drawBills(), drawWorkOrders()]);
    bindCommonActions();
  };
  main.querySelector("[data-new-rental-property]")?.addEventListener("click", () =>
    openDialog(
      "登记托管物业",
      `<label>租赁房源<select name="house_id">${options.houses.map((house: any) => `<option value="${house.id}">${escapeHtml(house.title)} · ${escapeHtml(house.community)}</option>`).join("")}</select></label><label>托管类型<select name="management_type">${Object.entries(managementLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>托管负责人<select name="manager_user_id">${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)} · ${roleLabel(user.role)}</option>`).join("")}</select></label><label>业主月付款<input name="owner_payment" type="number" min="0" step="0.01" value="0" /></label><label>开始日期<input name="start_date" type="date" required /></label><label>结束日期<input name="end_date" type="date" required /></label>`,
      async (fd) => {
        const result = await api("rental.properties.create", {
          house_id: fd.get("house_id"),
          management_type: fd.get("management_type"),
          manager_user_id: fd.get("manager_user_id"),
          owner_payment: Number(fd.get("owner_payment")),
          start_date: fd.get("start_date"),
          end_date: fd.get("end_date"),
        });
        toast(result.ok ? "托管物业草稿已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      }
    )
  );
  main.querySelector("[data-new-rental-lease]")?.addEventListener("click", () => {
    const activeProperties = properties.filter((property) => property.status === "active");
    openDialog(
      "登记租约",
      `<label>托管物业<select name="property_id">${activeProperties.map((property) => `<option value="${property.id}">${escapeHtml(property.house_title)}</option>`).join("")}</select></label><label>租客姓名<input name="tenant_name" required /></label><label>租客手机<input name="tenant_phone" required /></label><label>月租<input name="monthly_rent" type="number" min="0.01" step="0.01" required /></label><label>押金<input name="deposit_amount" type="number" min="0" step="0.01" value="0" /></label><label>付款周期<select name="payment_cycle_months"><option value="1">月付</option><option value="2">两月付</option><option value="3">季付</option><option value="6">半年付</option><option value="12">年付</option></select></label><label>开始日期<input name="start_date" type="date" required /></label><label>结束日期<input name="end_date" type="date" required /></label><label>首期应收日期<input name="first_due_date" type="date" required /></label>`,
      async (fd) => {
        const result = await api("rental.leases.create", {
          property_id: fd.get("property_id"),
          tenant_name: fd.get("tenant_name"),
          tenant_phone: fd.get("tenant_phone"),
          monthly_rent: Number(fd.get("monthly_rent")),
          deposit_amount: Number(fd.get("deposit_amount")),
          payment_cycle_months: Number(fd.get("payment_cycle_months")),
          start_date: fd.get("start_date"),
          end_date: fd.get("end_date"),
          first_due_date: fd.get("first_due_date"),
        });
        toast(result.ok ? "租约草稿已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      }
    );
  });
  main.querySelector("[data-new-rental-work]")?.addEventListener("click", () => {
    const activeProperties = properties.filter((property) => property.status === "active");
    openDialog(
      "新建维修/保洁工单",
      `<label>托管物业<select name="property_id">${activeProperties.map((property) => `<option value="${property.id}">${escapeHtml(property.house_title)}</option>`).join("")}</select></label><label>关联租约<select name="lease_id"><option value="">不关联</option>${leases.filter((lease) => ["draft", "active"].includes(lease.status)).map((lease) => `<option value="${lease.id}">${escapeHtml(lease.tenant_name)} · ${escapeHtml(lease.house_title)}</option>`).join("")}</select></label><label>类型<select name="work_type"><option value="maintenance">维修</option><option value="cleaning">保洁</option></select></label>${isManagerial ? `<label>负责人<select name="assignee_user_id">${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("")}</select></label>` : `<label>负责人<input value="${escapeHtml(state.user.display_name)}（本人）" disabled /></label>`}<label>预计费用<input name="expected_cost" type="number" min="0" step="0.01" value="0" /></label><label class="full">问题描述<textarea name="description" rows="4" required></textarea></label>`,
      async (fd) => {
        const result = await api("rental.workOrders.create", {
          property_id: fd.get("property_id"),
          lease_id: fd.get("lease_id") || null,
          work_type: fd.get("work_type"),
          assignee_user_id: fd.get("assignee_user_id"),
          expected_cost: Number(fd.get("expected_cost")),
          description: fd.get("description"),
        });
        toast(result.ok ? "租赁工单已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAll();
      }
    );
  });
  await drawAll();
}

async function renderCustomerCare(main: HTMLElement) {
  const isManagerial = ["admin", "store_manager"].includes(state.user.role);
  const optionsResult = await api("customerCare.options");
  const options = optionsResult.ok
    ? (optionsResult.data as any)
    : { customers: [], deals: [], users: [] };
  const caseTypeLabels: Record<string, string> = {
    complaint: "客户投诉",
    lawsuit: "诉讼案件",
  };
  const taskTypeLabels: Record<string, string> = {
    survey: "满意度调查",
    callback: "客户回访",
  };
  const severityLabels: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
    critical: "重大",
  };
  const statusLabels: Record<string, string> = {
    open: "待分派",
    assigned: "已分派",
    investigating: "处理中",
    resolved: "已解决",
    closed: "已结案",
    withdrawn: "已撤回",
    pending: "待执行",
    overdue: "已超期",
    completed: "已完成",
    cancelled: "已取消",
  };
  main.innerHTML = `
    <div class="header"><h2>客户关怀</h2><div class="ops">
      <button class="btn ghost" data-new-care-case>登记投诉/诉讼</button>
      <button class="btn" data-new-care-task>发起调查/回访</button>
    </div></div>
    <div class="filters">
      <select data-care-kind><option value="">全部业务</option><option value="complaint">投诉</option><option value="lawsuit">诉讼</option><option value="survey">满意度调查</option><option value="callback">客户回访</option></select>
      <select data-care-status><option value="">全部状态</option><option value="open">待分派</option><option value="assigned">已分派</option><option value="investigating">处理中</option><option value="resolved">已解决</option><option value="closed">已结案</option><option value="pending">待执行</option><option value="overdue">已超期</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select>
    </div>
    <section><h3>投诉与诉讼</h3><div class="list" data-care-cases></div></section>
    <section><h3>满意度调查与客户回访</h3><div class="list" data-care-tasks></div></section>
  `;
  let cases: any[] = [];
  const showEvents = async (entityType: string, entityId: string, title: string) => {
    const result = await api("customerCare.events", {
      entity_type: entityType,
      entity_id: entityId,
    });
    if (!result.ok) return toast(result.message, "error");
    openInfoDialog(
      `${title}履历`,
      (result.data as any[])
        .map(
          (event) =>
            `<div class="row"><div><strong>${escapeHtml(event.event_type)}</strong><div class="meta">${escapeHtml(event.created_by_name)} · ${new Date(event.created_at).toLocaleString("zh-CN")} · ${escapeHtml(event.details)}</div></div></div>`
        )
        .join("") || `<div class="empty">暂无履历</div>`
    );
  };
  const uploadCaseFile = async (careCase: any) => {
    if (!desktopShell?.chooseFiles) return toast("请在 Electron 桌面端上传处理凭证", "error");
    const paths = (await desktopShell.chooseFiles()) as string[];
    const category =
      careCase.case_type === "lawsuit" ? "legal_document" : "complaint_evidence";
    for (const localPath of paths) {
      const result = await api("attachment.add", {
        parent_type: "customer_care_case",
        parent_id: careCase.id,
        category,
        name: localPath.split(/[\\/]/).pop() || "客户关怀凭证",
        local_path: localPath,
      });
      if (!result.ok) return toast(result.message, "error");
    }
    toast(paths.length ? `已上传 ${paths.length} 个处理凭证` : "未选择文件");
    if (paths.length) draw();
  };
  const drawCases = async (kind: string, status: string) => {
    if (["survey", "callback"].includes(kind)) {
      cases = [];
      main.querySelector("[data-care-cases]")!.innerHTML =
        `<div class="empty">当前筛选不包含投诉或诉讼</div>`;
      return;
    }
    const result = await api("customerCare.cases.list", {
      case_type: ["complaint", "lawsuit"].includes(kind) ? kind : undefined,
      status: ["open", "assigned", "investigating", "resolved", "closed", "withdrawn"].includes(
        status
      )
        ? status
        : undefined,
    });
    const list = main.querySelector("[data-care-cases]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    cases = result.data as any[];
    list.innerHTML =
      cases
        .map((careCase) => {
          const canManage =
            state.user.role === "admin" ||
            (state.user.role === "store_manager" &&
              careCase.store_id === state.user.store_id);
          const canOperate = canManage || careCase.assignee_user_id === state.user.id;
          const canUpload =
            !["closed", "withdrawn"].includes(careCase.status) &&
            (canOperate || careCase.created_by === state.user.id);
          return `<div class="row"><div>
            <div><span class="tag ${careCase.status === "closed" ? "ok" : careCase.severity === "critical" ? "danger" : "warn"}">${statusLabels[careCase.status]}</span><span class="tag">${caseTypeLabels[careCase.case_type]}</span><span class="tag">${severityLabels[careCase.severity]}</span><strong>${escapeHtml(careCase.title)}</strong></div>
            <div>${escapeHtml(careCase.description)}</div>
            <div class="meta">${escapeHtml(careCase.store_name)} · 客户 ${escapeHtml(careCase.customer_name)} ${escapeHtml(careCase.customer_phone)} · 发起 ${escapeHtml(careCase.creator_name)}${careCase.assignee_name ? ` · 处理 ${escapeHtml(careCase.assignee_name)}` : ""}${careCase.due_date ? ` · 期限 ${careCase.due_date}` : ""} · 附件 ${careCase.attachment_count}${careCase.legal_case_no ? ` · ${escapeHtml(careCase.legal_case_no)} · ${escapeHtml(careCase.court_name)}` : ""}${careCase.resolution ? ` · 结果：${escapeHtml(careCase.resolution)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-care-events="case:${careCase.id}:${caseTypeLabels[careCase.case_type]}">履历</button>
            ${canUpload ? `<button class="btn ghost" data-care-case-file="${careCase.id}">上传凭证</button>` : ""}
            ${canManage && ["open", "assigned", "investigating"].includes(careCase.status) ? `<button class="btn ghost" data-assign-care-case="${careCase.id}">分派</button>` : ""}
            ${canOperate && careCase.status === "assigned" ? `<button class="btn" data-investigate-care-case="${careCase.id}">开始处理</button>` : ""}
            ${canOperate && ["assigned", "investigating"].includes(careCase.status) ? `<button class="btn" data-resolve-care-case="${careCase.id}">解决</button>` : ""}
            ${canManage && careCase.status === "resolved" ? `<button class="btn" data-close-care-case="${careCase.id}">结案</button>` : ""}
            ${careCase.created_by === state.user.id && careCase.status === "open" ? `<button class="btn danger" data-withdraw-care-case="${careCase.id}">撤回</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无投诉或诉讼案件</div>`;
    list.querySelectorAll("[data-care-case-file]").forEach((button) =>
      button.addEventListener("click", () => {
        const careCase = cases.find(
          (item) => item.id === (button as HTMLElement).dataset.careCaseFile
        );
        if (careCase) uploadCaseFile(careCase);
      })
    );
    list.querySelectorAll("[data-assign-care-case]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "分派客户关怀案件",
          `<label>处理人<select name="assignee_user_id">${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)} · ${roleLabel(user.role)}</option>`).join("")}</select></label><label>处理期限<input name="due_date" type="date" required /></label>`,
          async (fd) => {
            const result = await api("customerCare.cases.assign", {
              id: (button as HTMLElement).dataset.assignCareCase,
              assignee_user_id: fd.get("assignee_user_id"),
              due_date: fd.get("due_date"),
            });
            toast(result.ok ? "案件已分派" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
    list.querySelectorAll("[data-investigate-care-case]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("customerCare.cases.investigate", {
          id: (button as HTMLElement).dataset.investigateCareCase,
        });
        toast(result.ok ? "案件已进入处理" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-resolve-care-case]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "登记解决方案",
          `<label class="full">解决方案<textarea name="resolution" rows="5" required></textarea></label>`,
          async (fd) => {
            const result = await api("customerCare.cases.resolve", {
              id: (button as HTMLElement).dataset.resolveCareCase,
              resolution: fd.get("resolution"),
            });
            toast(result.ok ? "案件已解决" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
    list.querySelectorAll("[data-close-care-case]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("customerCare.cases.close", {
          id: (button as HTMLElement).dataset.closeCareCase,
        });
        toast(result.ok ? "案件已结案" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-withdraw-care-case]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("案件撤回原因");
        if (!reason) return;
        const result = await api("customerCare.cases.withdraw", {
          id: (button as HTMLElement).dataset.withdrawCareCase,
          reason,
        });
        toast(result.ok ? "案件已撤回" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  const drawTasks = async (kind: string, status: string) => {
    if (["complaint", "lawsuit"].includes(kind)) {
      main.querySelector("[data-care-tasks]")!.innerHTML =
        `<div class="empty">当前筛选不包含调查或回访</div>`;
      return;
    }
    const result = await api("customerCare.tasks.list", {
      task_type: ["survey", "callback"].includes(kind) ? kind : undefined,
      status: ["pending", "overdue", "completed", "cancelled"].includes(status)
        ? status
        : undefined,
    });
    const list = main.querySelector("[data-care-tasks]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map((task) => {
          const canManage =
            state.user.role === "admin" ||
            (state.user.role === "store_manager" && task.store_id === state.user.store_id);
          const canComplete = canManage || task.assignee_user_id === state.user.id;
          const canCancel = canManage || task.created_by === state.user.id;
          return `<div class="row"><div>
            <div><span class="tag ${task.status === "completed" ? "ok" : task.status === "overdue" ? "danger" : "warn"}">${statusLabels[task.status]}</span><span class="tag">${taskTypeLabels[task.task_type]}</span><strong>${escapeHtml(task.customer_name)}</strong> · ${escapeHtml(task.customer_phone)}</div>
            <div>${escapeHtml(task.purpose)}</div><div class="meta">执行 ${escapeHtml(task.assignee_name)} · 计划 ${new Date(task.due_at).toLocaleString("zh-CN")}${task.result ? ` · 结果：${escapeHtml(task.result)}` : ""}${task.satisfaction_score ? ` · 满意度 ${task.satisfaction_score}/5` : ""}${task.cancel_reason ? ` · 取消：${escapeHtml(task.cancel_reason)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-care-events="task:${task.id}:${taskTypeLabels[task.task_type]}">履历</button>
            ${canComplete && ["pending", "overdue"].includes(task.status) ? `<button class="btn" data-complete-care-task="${task.id}" data-task-type="${task.task_type}">完成</button>` : ""}
            ${canCancel && ["pending", "overdue"].includes(task.status) ? `<button class="btn danger" data-cancel-care-task="${task.id}">取消</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无满意度调查或客户回访</div>`;
    list.querySelectorAll("[data-complete-care-task]").forEach((button) =>
      button.addEventListener("click", () => {
        const element = button as HTMLElement;
        openDialog(
          `完成${taskTypeLabels[element.dataset.taskType!]}`,
          `<label class="full">结果<textarea name="result" rows="4" required></textarea></label><label>满意度评分（1-5）<input name="satisfaction_score" type="number" min="1" max="5" ${element.dataset.taskType === "survey" ? "required" : ""} /></label>`,
          async (fd) => {
            const result = await api("customerCare.tasks.complete", {
              id: element.dataset.completeCareTask,
              result: fd.get("result"),
              satisfaction_score: fd.get("satisfaction_score")
                ? Number(fd.get("satisfaction_score"))
                : null,
            });
            toast(result.ok ? "关怀任务已完成" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        );
      })
    );
    list.querySelectorAll("[data-cancel-care-task]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("任务取消原因");
        if (!reason) return;
        const result = await api("customerCare.tasks.cancel", {
          id: (button as HTMLElement).dataset.cancelCareTask,
          reason,
        });
        toast(result.ok ? "关怀任务已取消" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  const bindEvents = () => {
    main.querySelectorAll("[data-care-events]").forEach((button) =>
      button.addEventListener("click", () => {
        const [entityType, entityId, title] = String(
          (button as HTMLElement).dataset.careEvents
        ).split(":");
        showEvents(entityType, entityId, title);
      })
    );
  };
  const draw = async () => {
    const kind = (main.querySelector("[data-care-kind]") as HTMLSelectElement).value;
    const status = (main.querySelector("[data-care-status]") as HTMLSelectElement).value;
    await Promise.all([drawCases(kind, status), drawTasks(kind, status)]);
    bindEvents();
  };
  main.querySelector("[data-new-care-case]")!.addEventListener("click", () => {
    openDialog(
      "登记客户投诉或诉讼",
      `<label>类型<select name="case_type"><option value="complaint">客户投诉</option>${isManagerial ? `<option value="lawsuit">诉讼案件</option>` : ""}</select></label><label>客户<select name="customer_id">${options.customers.map((customer: any) => `<option value="${customer.id}">${escapeHtml(customer.name)} · ${escapeHtml(customer.phone)}</option>`).join("")}</select></label><label>关联成交<select name="deal_id"><option value="">不关联</option>${options.deals.map((deal: any) => `<option value="${deal.id}">${escapeHtml(deal.id)} · ¥${money(deal.contract_price)}</option>`).join("")}</select></label><label>严重程度<select name="severity"><option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option><option value="critical">重大</option></select></label><label class="full">标题<input name="title" required /></label><label class="full">情况描述<textarea name="description" rows="5" required></textarea></label><label>诉讼案号<input name="legal_case_no" /></label><label>法院<input name="court_name" /></label>`,
      async (fd) => {
        const result = await api("customerCare.cases.create", {
          case_type: fd.get("case_type"),
          customer_id: fd.get("customer_id"),
          deal_id: fd.get("deal_id") || null,
          severity: fd.get("severity"),
          title: fd.get("title"),
          description: fd.get("description"),
          legal_case_no: fd.get("legal_case_no"),
          court_name: fd.get("court_name"),
        });
        toast(result.ok ? "客户关怀案件已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    );
  });
  main.querySelector("[data-new-care-task]")!.addEventListener("click", () => {
    openDialog(
      "发起满意度调查或客户回访",
      `<label>类型<select name="task_type">${isManagerial ? `<option value="survey">满意度调查</option>` : ""}<option value="callback">客户回访</option></select></label><label>客户<select name="customer_id">${options.customers.map((customer: any) => `<option value="${customer.id}">${escapeHtml(customer.name)} · ${escapeHtml(customer.phone)}</option>`).join("")}</select></label>${isManagerial ? `<label>执行人<select name="assignee_user_id">${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)} · ${roleLabel(user.role)}</option>`).join("")}</select></label>` : `<label>执行人<input value="${escapeHtml(state.user.display_name)}（本人）" disabled /></label>`}<label>计划完成<input name="due_at" type="datetime-local" required /></label><label class="full">调查/回访目的<textarea name="purpose" rows="4" required></textarea></label>`,
      async (fd) => {
        const result = await api("customerCare.tasks.create", {
          task_type: fd.get("task_type"),
          customer_id: fd.get("customer_id"),
          assignee_user_id: fd.get("assignee_user_id"),
          due_at: fd.get("due_at"),
          purpose: fd.get("purpose"),
        });
        toast(result.ok ? "客户关怀任务已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    );
  });
  main.querySelector("[data-care-kind]")!.addEventListener("change", draw);
  main.querySelector("[data-care-status]")!.addEventListener("change", draw);
  await draw();
}

async function renderMarketing(main: HTMLElement) {
  const isManagerial = ["admin", "store_manager"].includes(state.user.role);
  const optionsResult = await api("marketing.options");
  const options = optionsResult.ok
    ? (optionsResult.data as any)
    : { stores: [], users: [], campaigns: [] };
  const channelLabels: Record<string, string> = {
    website: "官网/微站",
    wechat: "微信",
    douyin: "抖音/视频号",
    referral: "转介绍",
    walk_in: "到店",
    phone: "来电",
    campaign: "营销活动",
    other: "其他",
  };
  const intentLabels: Record<string, string> = {
    buy: "求购",
    rent: "求租",
    sell: "出售委托",
    entrust: "其他委托",
  };
  const leadStatusLabels: Record<string, string> = {
    new: "新建",
    contacting: "跟进中",
    qualified: "已确认",
    converted: "已转客",
    lost: "已流失",
    invalid: "无效",
  };
  const campaignStatusLabels: Record<string, string> = {
    draft: "草稿",
    active: "进行中",
    closed: "已关闭",
  };
  const entrustLabels: Record<string, string> = {
    sell: "出售",
    rent: "出租",
    buy: "求购",
  };
  const entrustStatusLabels: Record<string, string> = {
    new: "待受理",
    converted: "已转线索",
    rejected: "已驳回",
  };
  main.innerHTML = `
    <div class="header"><h2>营销线索</h2><div class="ops">
      ${isManagerial ? `<button class="btn ghost" data-new-campaign>新建活动</button>` : ""}
      <button class="btn ghost" data-new-entrustment>登记在线委托</button>
      <button class="btn" data-new-lead>录入线索</button>
    </div></div>
    <div class="filters">
      <select data-lead-status><option value="">全部线索状态</option>${Object.entries(leadStatusLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>
      <select data-lead-channel><option value="">全部渠道</option>${Object.entries(channelLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>
    </div>
    <section><h3>营销活动</h3><div class="list" data-marketing-campaigns></div></section>
    <section><h3>商机线索</h3><div class="list" data-marketing-leads></div></section>
    <section><h3>在线委托</h3><div class="list" data-marketing-entrustments></div></section>
  `;
  const showEvents = async (entityType: string, entityId: string, title: string) => {
    const result = await api("marketing.events", {
      entity_type: entityType,
      entity_id: entityId,
    });
    if (!result.ok) return toast(result.message, "error");
    openInfoDialog(
      `${title}履历`,
      (result.data as any[])
        .map(
          (event) =>
            `<div class="row"><div><strong>${escapeHtml(event.event_type)}</strong><div class="meta">${escapeHtml(event.created_by_name)} · ${new Date(event.created_at).toLocaleString("zh-CN")} · ${escapeHtml(event.details)}</div></div></div>`
        )
        .join("") || `<div class="empty">暂无履历</div>`
    );
  };
  const drawCampaigns = async () => {
    const result = await api("marketing.campaigns.list");
    const list = main.querySelector("[data-marketing-campaigns]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map((campaign) => {
          const canManage =
            state.user.role === "admin" ||
            (state.user.role === "store_manager" &&
              (!campaign.store_id || campaign.store_id === state.user.store_id));
          return `<div class="row"><div>
            <div><span class="tag ${campaign.status === "active" ? "ok" : campaign.status === "draft" ? "warn" : ""}">${campaignStatusLabels[campaign.status]}</span><span class="tag">${channelLabels[campaign.channel] || campaign.channel}</span><strong>${escapeHtml(campaign.name)}</strong></div>
            <div class="meta">${campaign.store_name ? escapeHtml(campaign.store_name) : "全公司"} · ${campaign.start_date} 至 ${campaign.end_date} · 预算 ¥${money(campaign.budget)} · 线索 ${campaign.lead_count}${campaign.remark ? ` · ${escapeHtml(campaign.remark)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-mkt-events="campaign:${campaign.id}:活动">履历</button>
            ${canManage && campaign.status === "draft" ? `<button class="btn" data-activate-campaign="${campaign.id}">启用</button>` : ""}
            ${canManage && ["draft", "active"].includes(campaign.status) ? `<button class="btn danger" data-close-campaign="${campaign.id}">关闭</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无营销活动</div>`;
    list.querySelectorAll("[data-activate-campaign]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("marketing.campaigns.status", {
          id: (button as HTMLElement).dataset.activateCampaign,
          status: "active",
        });
        toast(result.ok ? "活动已启用" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-close-campaign]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("marketing.campaigns.status", {
          id: (button as HTMLElement).dataset.closeCampaign,
          status: "closed",
        });
        toast(result.ok ? "活动已关闭" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  const drawLeads = async () => {
    const status = (main.querySelector("[data-lead-status]") as HTMLSelectElement).value;
    const channel = (main.querySelector("[data-lead-channel]") as HTMLSelectElement).value;
    const result = await api("marketing.leads.list", {
      status: status || undefined,
      channel: channel || undefined,
    });
    const list = main.querySelector("[data-marketing-leads]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const leads = result.data as any[];
    list.innerHTML =
      leads
        .map((lead) => {
          const canManage =
            state.user.role === "admin" ||
            (state.user.role === "store_manager" && lead.store_id === state.user.store_id);
          const canOperate =
            canManage ||
            lead.assignee_user_id === state.user.id ||
            (lead.created_by === state.user.id && !lead.assignee_user_id);
          return `<div class="row"><div>
            <div><span class="tag ${lead.status === "converted" ? "ok" : ["lost", "invalid"].includes(lead.status) ? "danger" : "warn"}">${leadStatusLabels[lead.status]}</span><span class="tag">${channelLabels[lead.channel] || lead.channel}</span><span class="tag">${intentLabels[lead.intent] || lead.intent}</span><strong>${escapeHtml(lead.contact_name)}</strong> · ${escapeHtml(lead.contact_phone)}</div>
            <div class="meta">${escapeHtml(lead.store_name)}${lead.campaign_name ? ` · 活动 ${escapeHtml(lead.campaign_name)}` : ""} · 负责人 ${escapeHtml(lead.assignee_name || "未分派")}${lead.need ? ` · ${escapeHtml(lead.need)}` : ""}${lead.budget_note ? ` · ${escapeHtml(lead.budget_note)}` : ""}${lead.lost_reason ? ` · 原因：${escapeHtml(lead.lost_reason)}` : ""}${lead.converted_customer_id ? ` · 客源 ${escapeHtml(lead.converted_customer_id)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-mkt-events="lead:${lead.id}:线索">履历</button>
            ${canManage && ["new", "contacting", "qualified"].includes(lead.status) ? `<button class="btn ghost" data-assign-lead="${lead.id}">分派</button>` : ""}
            ${canOperate && lead.status === "new" ? `<button class="btn" data-lead-status="${lead.id}:contacting">开始跟进</button>` : ""}
            ${canOperate && lead.status === "contacting" ? `<button class="btn" data-lead-status="${lead.id}:qualified">确认意向</button>` : ""}
            ${canOperate && ["contacting", "qualified"].includes(lead.status) ? `<button class="btn" data-convert-lead="${lead.id}">转客源</button>` : ""}
            ${canOperate && ["new", "contacting", "qualified"].includes(lead.status) ? `<button class="btn danger" data-lose-lead="${lead.id}">流失/无效</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无商机线索</div>`;
    list.querySelectorAll("[data-assign-lead]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "分派营销线索",
          `<label>负责人<select name="assignee_user_id">${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)} · ${roleLabel(user.role)}</option>`).join("")}</select></label>`,
          async (fd) => {
            const result = await api("marketing.leads.assign", {
              id: (button as HTMLElement).dataset.assignLead,
              assignee_user_id: fd.get("assignee_user_id"),
            });
            toast(result.ok ? "线索已分派" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
    list.querySelectorAll("[data-lead-status]").forEach((button) =>
      button.addEventListener("click", async () => {
        const [id, status] = String((button as HTMLElement).dataset.leadStatus).split(":");
        const result = await api("marketing.leads.status", { id, status });
        toast(result.ok ? "线索状态已更新" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-convert-lead]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!confirm("确认将该线索转为私客？")) return;
        const result = await api("marketing.leads.convert", {
          id: (button as HTMLElement).dataset.convertLead,
        });
        toast(result.ok ? "线索已转客源" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-lose-lead]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "标记线索流失或无效",
          `<label>结果<select name="status"><option value="lost">已流失</option><option value="invalid">无效</option></select></label><label class="full">原因<input name="reason" required /></label>`,
          async (fd) => {
            const result = await api("marketing.leads.status", {
              id: (button as HTMLElement).dataset.loseLead,
              status: fd.get("status"),
              reason: fd.get("reason"),
            });
            toast(result.ok ? "线索已关闭" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
  };
  const drawEntrustments = async () => {
    const result = await api("marketing.entrustments.list");
    const list = main.querySelector("[data-marketing-entrustments]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map((item) => {
          const canManage =
            state.user.role === "admin" ||
            (state.user.role === "store_manager" && item.store_id === state.user.store_id);
          return `<div class="row"><div>
            <div><span class="tag ${item.status === "converted" ? "ok" : item.status === "rejected" ? "danger" : "warn"}">${entrustStatusLabels[item.status]}</span><span class="tag">${entrustLabels[item.entrust_type]}</span><strong>${escapeHtml(item.contact_name)}</strong> · ${escapeHtml(item.contact_phone)}</div>
            <div>${escapeHtml(item.content)}</div>
            <div class="meta">${escapeHtml(item.store_name)}${item.community ? ` · ${escapeHtml(item.community)}` : ""}${item.expected_price != null ? ` · 期望 ¥${money(item.expected_price)}` : ""}${item.lead_id ? ` · 线索 ${escapeHtml(item.lead_id)}` : ""}${item.reject_reason ? ` · 驳回：${escapeHtml(item.reject_reason)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-mkt-events="entrustment:${item.id}:在线委托">履历</button>
            ${canManage && item.status === "new" ? `<button class="btn" data-accept-entrustment="${item.id}">转线索</button><button class="btn danger" data-reject-entrustment="${item.id}">驳回</button>` : ""}
          </div></div>`;
        })
        .join("") || `<div class="empty">暂无在线委托</div>`;
    list.querySelectorAll("[data-accept-entrustment]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "受理在线委托并转线索",
          `<label>线索负责人<select name="assignee_user_id">${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)} · ${roleLabel(user.role)}</option>`).join("")}</select></label>`,
          async (fd) => {
            const result = await api("marketing.entrustments.accept", {
              id: (button as HTMLElement).dataset.acceptEntrustment,
              assignee_user_id: fd.get("assignee_user_id"),
            });
            toast(result.ok ? "在线委托已转线索" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
    list.querySelectorAll("[data-reject-entrustment]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("驳回原因");
        if (!reason) return;
        const result = await api("marketing.entrustments.reject", {
          id: (button as HTMLElement).dataset.rejectEntrustment,
          reason,
        });
        toast(result.ok ? "在线委托已驳回" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  const bindEvents = () => {
    main.querySelectorAll("[data-mkt-events]").forEach((button) =>
      button.addEventListener("click", () => {
        const [entityType, entityId, title] = String(
          (button as HTMLElement).dataset.mktEvents
        ).split(":");
        showEvents(entityType, entityId, title);
      })
    );
  };
  const draw = async () => {
    await Promise.all([drawCampaigns(), drawLeads(), drawEntrustments()]);
    bindEvents();
  };
  main.querySelector("[data-new-campaign]")?.addEventListener("click", () =>
    openDialog(
      "新建营销活动",
      `${state.user.role === "admin" ? `<label>门店范围<select name="store_id"><option value="">全公司</option>${options.stores.map((store: any) => `<option value="${store.id}">${escapeHtml(store.name)}</option>`).join("")}</select></label>` : ""}<label>活动名称<input name="name" required /></label><label>渠道<select name="channel">${Object.entries(channelLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>开始日期<input name="start_date" type="date" required /></label><label>结束日期<input name="end_date" type="date" required /></label><label>预算<input name="budget" type="number" min="0" step="0.01" value="0" /></label><label class="full">备注<input name="remark" /></label>`,
      async (fd) => {
        const result = await api("marketing.campaigns.create", {
          store_id: fd.get("store_id") || null,
          name: fd.get("name"),
          channel: fd.get("channel"),
          start_date: fd.get("start_date"),
          end_date: fd.get("end_date"),
          budget: Number(fd.get("budget")),
          remark: fd.get("remark"),
        });
        toast(result.ok ? "营销活动草稿已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-new-lead]")!.addEventListener("click", () =>
    openDialog(
      "录入商机线索",
      `<label>联系人<input name="contact_name" required /></label><label>手机号<input name="contact_phone" required /></label><label>意向<select name="intent">${Object.entries(intentLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>渠道<select name="channel">${Object.entries(channelLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>关联活动<select name="campaign_id"><option value="">不关联</option>${options.campaigns.map((campaign: any) => `<option value="${campaign.id}">${escapeHtml(campaign.name)}</option>`).join("")}</select></label>${isManagerial ? `<label>负责人<select name="assignee_user_id"><option value="">暂不分派</option>${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("")}</select></label>` : ""}<label class="full">需求说明<input name="need" /></label><label class="full">预算说明<input name="budget_note" /></label>`,
      async (fd) => {
        const result = await api("marketing.leads.create", {
          contact_name: fd.get("contact_name"),
          contact_phone: fd.get("contact_phone"),
          intent: fd.get("intent"),
          channel: fd.get("channel"),
          campaign_id: fd.get("campaign_id") || null,
          assignee_user_id: fd.get("assignee_user_id") || null,
          need: fd.get("need"),
          budget_note: fd.get("budget_note"),
        });
        if (result.ok && (result.data as any).existing_customer_hint) {
          toast(
            `线索已创建，系统已有同号客源：${(result.data as any).existing_customer_hint.name}`,
            "warn"
          );
          draw();
          return;
        }
        toast(result.ok ? "商机线索已录入" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-new-entrustment]")!.addEventListener("click", () =>
    openDialog(
      "登记在线委托",
      `<label>委托类型<select name="entrust_type">${Object.entries(entrustLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>联系人<input name="contact_name" required /></label><label>手机号<input name="contact_phone" required /></label><label>小区<input name="community" /></label><label>期望价格<input name="expected_price" type="number" min="0" step="0.01" /></label><label>户型<input name="rooms" /></label><label>面积㎡<input name="area_size" type="number" min="0" step="0.01" /></label><label class="full">地址<input name="address" /></label><label class="full">委托内容<textarea name="content" rows="4" required></textarea></label>`,
      async (fd) => {
        const result = await api("marketing.entrustments.create", {
          entrust_type: fd.get("entrust_type"),
          contact_name: fd.get("contact_name"),
          contact_phone: fd.get("contact_phone"),
          community: fd.get("community"),
          expected_price: fd.get("expected_price") || null,
          rooms: fd.get("rooms"),
          area_size: fd.get("area_size") || null,
          address: fd.get("address"),
          content: fd.get("content"),
        });
        toast(result.ok ? "在线委托已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-lead-status]")!.addEventListener("change", draw);
  main.querySelector("[data-lead-channel]")!.addEventListener("change", draw);
  await draw();
}

async function renderPerformance(main: HTMLElement) {
  const isAdmin = state.user.role === "admin";
  const isFinance = state.user.role === "finance";
  const isManagerial = isAdmin || state.user.role === "store_manager";
  const optionsResult = await api("performance.options");
  const options = optionsResult.ok
    ? (optionsResult.data as any)
    : { stores: [], users: [], rules: [] };
  const metricLabels: Record<string, string> = {
    commission: "佣金业绩",
    deals: "成交单数",
  };
  const statusLabels: Record<string, string> = {
    pending: "待审批",
    approved: "已通过",
    rejected: "已驳回",
    draft: "草稿",
    calculated: "已计算",
    paid: "已发放",
    active: "生效",
    inactive: "停用",
  };
  main.innerHTML = `
    <div class="header"><h2>积分分红</h2><div class="ops">
      ${isAdmin ? `<button class="btn ghost" data-new-point-rule>积分规则</button><button class="btn ghost" data-new-dividend>新建分红</button>` : ""}
      ${isManagerial ? `<button class="btn ghost" data-new-point>录入积分</button><button class="btn ghost" data-new-target>设定目标</button>` : ""}
      ${isAdmin || isFinance ? `<button class="btn" data-new-bonus>生成管理奖</button>` : ""}
    </div></div>
    <section><h3>积分规则</h3><div class="list" data-point-rules></div></section>
    <section><h3>积分台账 <span class="meta" data-point-balance></span></h3><div class="list" data-point-entries></div></section>
    <section><h3>业绩目标</h3><div class="list" data-performance-targets></div></section>
    <section><h3>店长管理奖</h3><div class="list" data-bonus-batches></div></section>
    <section><h3>利润分红</h3><div class="list" data-dividend-batches></div></section>
  `;
  const drawRules = async () => {
    const result = await api("performance.rules.list");
    const list = main.querySelector("[data-point-rules]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (rule) => `<div class="row"><div><div><span class="tag ${rule.status === "active" ? "ok" : ""}">${statusLabels[rule.status]}</span><strong>${escapeHtml(rule.name)}</strong> · ${escapeHtml(rule.code)}</div><div class="meta">${rule.points > 0 ? "+" : ""}${rule.points} 分${rule.applicable_role ? ` · 适用 ${roleLabel(rule.applicable_role)}` : " · 全角色"}</div></div></div>`
        )
        .join("") || `<div class="empty">暂无积分规则</div>`;
  };
  const drawPoints = async () => {
    const result = await api("performance.points.list");
    const list = main.querySelector("[data-point-entries]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const payload = result.data as any;
    main.querySelector("[data-point-balance]")!.textContent = `当前有效积分 ${payload.balance}`;
    list.innerHTML =
      payload.entries
        .map(
          (entry: any) => `<div class="row"><div>
            <div><span class="tag ${entry.status === "approved" ? "ok" : entry.status === "rejected" ? "danger" : "warn"}">${statusLabels[entry.status]}</span><strong>${escapeHtml(entry.display_name)}</strong> · ${entry.points > 0 ? "+" : ""}${entry.points}</div>
            <div class="meta">${escapeHtml(entry.store_name)}${entry.rule_name ? ` · ${escapeHtml(entry.rule_name)}` : ""} · ${escapeHtml(entry.reason)}${entry.reject_reason ? ` · 驳回：${escapeHtml(entry.reject_reason)}` : ""}</div>
          </div><div class="ops">
            ${isAdmin && entry.status === "pending" ? `<button class="btn" data-approve-point="${entry.id}">通过</button><button class="btn danger" data-reject-point="${entry.id}">驳回</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无积分记录</div>`;
    list.querySelectorAll("[data-approve-point]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("performance.points.review", {
          id: (button as HTMLElement).dataset.approvePoint,
          status: "approved",
        });
        toast(result.ok ? "积分已通过" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-reject-point]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("驳回原因");
        if (!reason) return;
        const result = await api("performance.points.review", {
          id: (button as HTMLElement).dataset.rejectPoint,
          status: "rejected",
          reject_reason: reason,
        });
        toast(result.ok ? "积分已驳回" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  const drawTargets = async () => {
    const result = await api("performance.targets.list");
    const list = main.querySelector("[data-performance-targets]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (target) => `<div class="row"><div>
            <div><span class="tag ok">${target.period_month}</span><span class="tag">${metricLabels[target.metric]}</span><strong>${escapeHtml(target.user_name || "门店合计")}</strong></div>
            <div class="meta">${escapeHtml(target.store_name)} · 目标 ${money(target.target_value)} · 完成 ${money(target.actual_value)} · 完成率 ${target.completion_rate}%</div>
          </div></div>`
        )
        .join("") || `<div class="empty">暂无业绩目标</div>`;
  };
  const drawBonus = async () => {
    const result = await api("performance.bonus.list");
    const list = main.querySelector("[data-bonus-batches]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (batch) => `<div class="row"><div>
            <div><span class="tag ${batch.status === "paid" ? "ok" : "warn"}">${statusLabels[batch.status]}</span><strong>${batch.period_month}</strong> · ${escapeHtml(batch.store_name)}</div>
            <div class="meta">佣金基数 ¥${money(batch.commission_base)} · 比例 ${(Number(batch.award_rate) * 100).toFixed(1)}% · 奖金合计 ¥${money(batch.bonus_total)}${batch.payment_reference ? ` · 流水 ${escapeHtml(batch.payment_reference)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-bonus-items="${batch.id}">明细</button>
            ${(isAdmin || isFinance) && batch.status === "calculated" ? `<button class="btn" data-pay-bonus="${batch.id}">登记发放</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无管理奖批次</div>`;
    list.querySelectorAll("[data-bonus-items]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("performance.bonus.items", {
          batch_id: (button as HTMLElement).dataset.bonusItems,
        });
        if (!result.ok) return toast(result.message, "error");
        openInfoDialog(
          "管理奖明细",
          (result.data as any[])
            .map(
              (item) =>
                `<div class="row"><div><strong>${escapeHtml(item.display_name)}</strong><div class="meta">¥${money(item.amount)} · ${escapeHtml(item.note || "")}</div></div></div>`
            )
            .join("")
        );
      })
    );
    list.querySelectorAll("[data-pay-bonus]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "登记管理奖发放",
          `<label>发奖流水号<input name="payment_reference" required /></label>`,
          async (fd) => {
            const result = await api("performance.bonus.pay", {
              id: (button as HTMLElement).dataset.payBonus,
              payment_reference: fd.get("payment_reference"),
            });
            toast(result.ok ? "管理奖已登记发放" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
  };
  const drawDividend = async () => {
    const result = await api("performance.dividend.list");
    const list = main.querySelector("[data-dividend-batches]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (batch) => `<div class="row"><div>
            <div><span class="tag ${batch.status === "paid" ? "ok" : "warn"}">${statusLabels[batch.status]}</span><strong>${batch.period_month}</strong> · 分红池 ¥${money(batch.pool_amount)}</div>
            <div class="meta">参与积分 ${money(batch.total_points)} · 已分配 ¥${money(batch.allocated_total)}${batch.payment_reference ? ` · 流水 ${escapeHtml(batch.payment_reference)}` : ""}</div>
          </div><div class="ops">
            <button class="btn ghost" data-dividend-items="${batch.id}">明细</button>
            ${(isAdmin || isFinance) && batch.status === "calculated" ? `<button class="btn" data-pay-dividend="${batch.id}">登记发放</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无利润分红批次</div>`;
    list.querySelectorAll("[data-dividend-items]").forEach((button) =>
      button.addEventListener("click", async () => {
        const result = await api("performance.dividend.items", {
          batch_id: (button as HTMLElement).dataset.dividendItems,
        });
        if (!result.ok) return toast(result.message, "error");
        openInfoDialog(
          "分红明细",
          (result.data as any[])
            .map(
              (item) =>
                `<div class="row"><div><strong>${escapeHtml(item.display_name)}</strong><div class="meta">${escapeHtml(item.store_name)} · 积分 ${money(item.points)} · 分红 ¥${money(item.share_amount)}</div></div></div>`
            )
            .join("")
        );
      })
    );
    list.querySelectorAll("[data-pay-dividend]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "登记分红发放",
          `<label>分红流水号<input name="payment_reference" required /></label>`,
          async (fd) => {
            const result = await api("performance.dividend.pay", {
              id: (button as HTMLElement).dataset.payDividend,
              payment_reference: fd.get("payment_reference"),
            });
            toast(result.ok ? "分红已登记发放" : result.message, result.ok ? "ok" : "error");
            if (result.ok) draw();
          }
        )
      )
    );
  };
  const draw = async () => {
    await Promise.all([drawRules(), drawPoints(), drawTargets(), drawBonus(), drawDividend()]);
  };
  main.querySelector("[data-new-point-rule]")?.addEventListener("click", () =>
    openDialog(
      "维护积分规则",
      `<label>代码<input name="code" required /></label><label>名称<input name="name" required /></label><label>积分值<input name="points" type="number" step="0.01" required /></label><label>适用角色<select name="applicable_role"><option value="">全角色</option><option value="agent">经纪人</option><option value="store_manager">店长</option></select></label>`,
      async (fd) => {
        const result = await api("performance.rules.save", {
          code: fd.get("code"),
          name: fd.get("name"),
          points: Number(fd.get("points")),
          applicable_role: fd.get("applicable_role") || null,
        });
        toast(result.ok ? "积分规则已保存" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-new-point]")?.addEventListener("click", () =>
    openDialog(
      "录入积分",
      `<label>员工<select name="user_id">${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)} · ${roleLabel(user.role)}</option>`).join("")}</select></label><label>积分规则<select name="rule_id"><option value="">自定义分值</option>${options.rules.map((rule: any) => `<option value="${rule.id}">${escapeHtml(rule.name)} (${rule.points > 0 ? "+" : ""}${rule.points})</option>`).join("")}</select></label><label>自定义分值<input name="points" type="number" step="0.01" /></label><label class="full">原因<input name="reason" required /></label>`,
      async (fd) => {
        const result = await api("performance.points.create", {
          user_id: fd.get("user_id"),
          rule_id: fd.get("rule_id") || null,
          points: fd.get("points") ? Number(fd.get("points")) : undefined,
          reason: fd.get("reason"),
        });
        toast(result.ok ? "积分已录入" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-new-target]")?.addEventListener("click", () =>
    openDialog(
      "设定业绩目标",
      `${isAdmin ? `<label>门店<select name="store_id">${options.stores.map((store: any) => `<option value="${store.id}">${escapeHtml(store.name)}</option>`).join("")}</select></label>` : ""}<label>月份<input name="period_month" type="month" required /></label><label>指标<select name="metric"><option value="commission">佣金业绩</option><option value="deals">成交单数</option></select></label><label>员工<select name="user_id"><option value="">门店合计</option>${options.users.map((user: any) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("")}</select></label><label>目标值<input name="target_value" type="number" min="0.01" step="0.01" required /></label>`,
      async (fd) => {
        const result = await api("performance.targets.save", {
          store_id: fd.get("store_id") || state.user.store_id,
          period_month: fd.get("period_month"),
          metric: fd.get("metric"),
          user_id: fd.get("user_id") || null,
          target_value: Number(fd.get("target_value")),
        });
        toast(result.ok ? "业绩目标已设定" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-new-bonus]")?.addEventListener("click", () =>
    openDialog(
      "生成门店管理奖",
      `<label>门店<select name="store_id">${options.stores.map((store: any) => `<option value="${store.id}">${escapeHtml(store.name)}</option>`).join("")}</select></label><label>月份<input name="period_month" type="month" required /></label>`,
      async (fd) => {
        const result = await api("performance.bonus.create", {
          store_id: fd.get("store_id"),
          period_month: fd.get("period_month"),
        });
        toast(
          result.ok ? `管理奖已计算，合计 ¥${money((result.data as any).bonus_total)}` : result.message,
          result.ok ? "ok" : "error"
        );
        if (result.ok) draw();
      }
    )
  );
  main.querySelector("[data-new-dividend]")?.addEventListener("click", () =>
    openDialog(
      "新建利润分红批次",
      `<label>月份<input name="period_month" type="month" required /></label><label>分红池金额<input name="pool_amount" type="number" min="0.01" step="0.01" required /></label>`,
      async (fd) => {
        const result = await api("performance.dividend.create", {
          period_month: fd.get("period_month"),
          pool_amount: Number(fd.get("pool_amount")),
        });
        toast(result.ok ? "分红批次已按积分计算" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      }
    )
  );
  await draw();
}

async function renderFinanceAssets(main: HTMLElement) {
  const canWrite = ["admin", "finance"].includes(state.user.role);
  const options = await api("finance.options", {});
  const storeOptions = options.ok
    ? ((options.data as any).stores || [])
        .map((store: any) => `<option value="${store.id}">${store.name}</option>`)
        .join("")
    : "";
  const userOptions = options.ok
    ? ((options.data as any).users || [])
        .map((user: any) => `<option value="${user.id}">${user.display_name}</option>`)
        .join("")
    : "";
  main.innerHTML = `
    <div class="header"><h2>资产台账与备查凭证</h2><div class="ops">
      ${canWrite ? `<button class="btn ghost" data-new-asset>登记资产</button><button class="btn" data-new-voucher>新建凭证</button>` : ""}
    </div></div>
    <h3>固定资产</h3>
    <div class="filters"><select data-asset-status><option value="">全部状态</option><option value="in_use">在用</option><option value="idle">闲置</option><option value="disposed">已处置</option></select></div>
    <div class="list" data-assets></div>
    <h3>备查凭证</h3>
    <div class="filters"><select data-voucher-status><option value="">全部状态</option><option value="draft">草稿</option><option value="posted">已过账</option><option value="voided">已作废</option></select></div>
    <div class="list" data-vouchers></div>
  `;
  const drawAssets = async () => {
    const status = (main.querySelector("[data-asset-status]") as HTMLSelectElement).value;
    const result = await api("finance.assets.list", status ? { status } : {});
    const list = main.querySelector("[data-assets]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "in_use" ? "ok" : item.status === "disposed" ? "danger" : "warn"}">${item.status}</span><strong>${item.name}</strong> · ${item.code}</div>
            <div class="meta">${item.store_name} · ${item.category} · 原值 ${item.original_value}${item.custodian_name ? ` · 保管 ${item.custodian_name}` : ""}${item.location ? ` · ${item.location}` : ""}${item.dispose_reason ? ` · ${item.dispose_reason}` : ""}</div>
          </div><div class="ops">
            ${canWrite && item.status !== "disposed" ? `<button class="btn danger" data-dispose="${item.id}">处置</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无资产</div>`;
    list.querySelectorAll("[data-dispose]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "处置资产",
          `<label class="full">原因<input name="reason" required /></label>
           <label>处置金额<input name="dispose_amount" type="number" min="0" step="0.01" value="0" /></label>`,
          async (fd) => {
            const updated = await api("finance.assets.dispose", {
              id: (button as HTMLElement).dataset.dispose,
              reason: fd.get("reason"),
              dispose_amount: Number(fd.get("dispose_amount") || 0),
            });
            toast(updated.ok ? "资产已处置" : updated.message, updated.ok ? "ok" : "error");
            if (updated.ok) drawAssets();
          }
        )
      )
    );
  };
  const drawVouchers = async () => {
    const status = (main.querySelector("[data-voucher-status]") as HTMLSelectElement).value;
    const result = await api("finance.vouchers.list", status ? { status } : {});
    const list = main.querySelector("[data-vouchers]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "posted" ? "ok" : item.status === "voided" ? "danger" : "warn"}">${item.status}</span><strong>${item.voucher_no}</strong> · ${item.summary}</div>
            <div class="meta">${item.store_name} · ${item.voucher_date} · 借 ${item.debit_total} / 贷 ${item.credit_total} · ${item.line_count} 行${item.void_reason ? ` · ${item.void_reason}` : ""}</div>
          </div><div class="ops">
            ${canWrite && item.status === "draft" ? `<button class="btn" data-post="${item.id}">过账</button><button class="btn danger" data-void="${item.id}">作废</button>` : ""}
            ${canWrite && item.status === "posted" ? `<button class="btn danger" data-void="${item.id}">作废</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无凭证</div>`;
    list.querySelectorAll("[data-post]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("finance.vouchers.post", {
          id: (button as HTMLElement).dataset.post,
        });
        toast(updated.ok ? "凭证已过账" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawVouchers();
      })
    );
    list.querySelectorAll("[data-void]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("作废原因");
        if (!reason) return;
        const updated = await api("finance.vouchers.void", {
          id: (button as HTMLElement).dataset.void,
          reason,
        });
        toast(updated.ok ? "凭证已作废" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawVouchers();
      })
    );
  };
  main.querySelector("[data-new-asset]")?.addEventListener("click", () =>
    openDialog(
      "登记资产",
      `<label>编码<input name="code" required /></label>
       <label>名称<input name="name" required /></label>
       <label>分类<select name="category"><option value="furniture">家具</option><option value="equipment">设备</option><option value="vehicle">车辆</option><option value="electronics">电子设备</option><option value="other">其他</option></select></label>
       <label>门店<select name="store_id">${storeOptions}</select></label>
       <label>购置日期<input name="purchase_date" type="date" required /></label>
       <label>原值<input name="original_value" type="number" min="0.01" step="0.01" required /></label>
       <label>残值<input name="residual_value" type="number" min="0" step="0.01" value="0" /></label>
       <label>数量<input name="quantity" type="number" min="0.01" step="0.01" value="1" /></label>
       <label>保管人<select name="custodian_user_id"><option value="">无</option>${userOptions}</select></label>
       <label class="full">存放位置<input name="location" /></label>`,
      async (fd) => {
        const result = await api("finance.assets.save", {
          code: fd.get("code"),
          name: fd.get("name"),
          category: fd.get("category"),
          store_id: fd.get("store_id"),
          purchase_date: fd.get("purchase_date"),
          original_value: Number(fd.get("original_value")),
          residual_value: Number(fd.get("residual_value") || 0),
          quantity: Number(fd.get("quantity") || 1),
          custodian_user_id: fd.get("custodian_user_id") || null,
          location: fd.get("location"),
        });
        toast(result.ok ? "资产已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawAssets();
      }
    )
  );
  main.querySelector("[data-new-voucher]")?.addEventListener("click", () =>
    openDialog(
      "新建备查凭证",
      `<label>门店<select name="store_id">${storeOptions}</select></label>
       <label>日期<input name="voucher_date" type="date" required /></label>
       <label class="full">摘要<input name="summary" required /></label>
       <label>借方科目<input name="debit_account" value="银行存款" required /></label>
       <label>贷方科目<input name="credit_account" value="主营业务收入" required /></label>
       <label>金额<input name="amount" type="number" min="0.01" step="0.01" required /></label>`,
      async (fd) => {
        const amount = Number(fd.get("amount"));
        const result = await api("finance.vouchers.create", {
          store_id: fd.get("store_id"),
          voucher_date: fd.get("voucher_date"),
          summary: fd.get("summary"),
          lines: [
            {
              account_name: fd.get("debit_account"),
              direction: "debit",
              amount,
            },
            {
              account_name: fd.get("credit_account"),
              direction: "credit",
              amount,
            },
          ],
        });
        toast(
          result.ok ? `凭证草稿 ${(result.data as any).voucher_no} 已创建` : result.message,
          result.ok ? "ok" : "error"
        );
        if (result.ok) drawVouchers();
      }
    )
  );
  main.querySelector("[data-asset-status]")!.addEventListener("change", drawAssets);
  main.querySelector("[data-voucher-status]")!.addEventListener("change", drawVouchers);
  await Promise.all([drawAssets(), drawVouchers()]);
}

async function renderPropertyExt(main: HTMLElement) {
  const canWrite = state.user.role !== "finance";
  const options = await api("propertyExt.options", {});
  const houseOptions = options.ok
    ? ((options.data as any).houses || [])
        .map(
          (house: any) =>
            `<option value="${house.id}">${house.title} · ${house.community}</option>`
        )
        .join("")
    : "";
  const userOptions = options.ok
    ? ((options.data as any).users || [])
        .map((user: any) => `<option value="${user.id}">${user.display_name}</option>`)
        .join("")
    : "";
  main.innerHTML = `
    <div class="header"><h2>房源锁定、合作与业态</h2><div class="ops">
      ${canWrite ? `<button class="btn ghost" data-lock>锁定房源</button><button class="btn ghost" data-coop>建立合作</button><button class="btn ghost" data-media>登记媒体</button><button class="btn ghost" data-auction>拍卖资料</button><button class="btn" data-exclusive>独家/包销</button>` : ""}
    </div></div>
    <h3>锁定盘</h3><div class="list" data-locks></div>
    <h3>合作盘</h3><div class="list" data-coops></div>
    <h3>视频/全景</h3><div class="list" data-media-list></div>
  `;
  const drawLocks = async () => {
    const result = await api("propertyExt.locks.list", {});
    const list = main.querySelector("[data-locks]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag warn">锁定</span><strong>${item.title}</strong> · ${item.community}</div>
            <div class="meta">${item.lock_reason || ""}${item.lock_until ? ` · 至 ${item.lock_until}` : ""} · ${item.locked_by_name || ""}${item.locked_at ? ` · ${item.locked_at.slice(0, 16).replace("T", " ")}` : ""}</div>
          </div><div class="ops">
            ${canWrite ? `<button class="btn danger" data-unlock="${item.id}">解锁</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无锁定盘</div>`;
    list.querySelectorAll("[data-unlock]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("解锁原因");
        if (!reason) return;
        const updated = await api("propertyExt.locks.set", {
          id: (button as HTMLElement).dataset.unlock,
          locked: false,
          reason,
        });
        toast(updated.ok ? "已解锁" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawLocks();
      })
    );
  };
  const drawCoops = async () => {
    const result = await api("propertyExt.cooperations.list", { status: "active" });
    const list = main.querySelector("[data-coops]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ok">合作</span><strong>${item.house_title}</strong> · ${item.partner_name}</div>
            <div class="meta">${item.partner_user_name || item.partner_phone || "外部合作"}${item.share_ratio != null ? ` · 分成 ${item.share_ratio}%` : ""}${item.note ? ` · ${item.note}` : ""}</div>
          </div><div class="ops">
            ${canWrite ? `<button class="btn danger" data-end-coop="${item.id}">结束</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无有效合作</div>`;
    list.querySelectorAll("[data-end-coop]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("结束原因");
        if (!reason) return;
        const updated = await api("propertyExt.cooperations.end", {
          id: (button as HTMLElement).dataset.endCoop,
          reason,
        });
        toast(updated.ok ? "合作已结束" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawCoops();
      })
    );
  };
  const drawMedia = async () => {
    const result = await api("propertyExt.media.list", { status: "active" });
    const list = main.querySelector("[data-media-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag">${item.media_type === "video" ? "视频" : "全景"}</span><strong>${item.title}</strong> · ${item.house_title}</div>
            <div class="meta">${item.local_path}</div>
          </div><div class="ops">
            ${canWrite ? `<button class="btn danger" data-archive-media="${item.id}">归档</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无视频/全景</div>`;
    list.querySelectorAll("[data-archive-media]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("propertyExt.media.archive", {
          id: (button as HTMLElement).dataset.archiveMedia,
        });
        toast(updated.ok ? "媒体已归档" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawMedia();
      })
    );
  };
  main.querySelector("[data-lock]")?.addEventListener("click", () =>
    openDialog(
      "锁定房源",
      `<label class="full">房源<select name="id">${houseOptions}</select></label>
       <label class="full">原因<input name="reason" required /></label>
       <label>到期日<input name="lock_until" type="date" /></label>`,
      async (fd) => {
        const result = await api("propertyExt.locks.set", {
          id: fd.get("id"),
          locked: true,
          reason: fd.get("reason"),
          lock_until: fd.get("lock_until") || null,
        });
        toast(result.ok ? "房源已锁定" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawLocks();
      }
    )
  );
  main.querySelector("[data-coop]")?.addEventListener("click", () =>
    openDialog(
      "建立合作",
      `<label class="full">房源<select name="house_id">${houseOptions}</select></label>
       <label>合作员工<select name="partner_user_id"><option value="">外部合作</option>${userOptions}</select></label>
       <label>合作方名称<input name="partner_name" required /></label>
       <label>电话<input name="partner_phone" /></label>
       <label>分成%<input name="share_ratio" type="number" min="1" max="99" /></label>
       <label class="full">备注<input name="note" /></label>`,
      async (fd) => {
        const result = await api("propertyExt.cooperations.create", {
          house_id: fd.get("house_id"),
          partner_user_id: fd.get("partner_user_id") || null,
          partner_name: fd.get("partner_name"),
          partner_phone: fd.get("partner_phone"),
          share_ratio: fd.get("share_ratio") || null,
          note: fd.get("note"),
        });
        toast(result.ok ? "合作已建立" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawCoops();
      }
    )
  );
  main.querySelector("[data-media]")?.addEventListener("click", () =>
    openDialog(
      "登记视频/全景",
      `<label class="full">房源<select name="house_id">${houseOptions}</select></label>
       <label>类型<select name="media_type"><option value="video">视频</option><option value="panorama">全景</option></select></label>
       <label>标题<input name="title" required /></label>
       <label class="full">本地路径<input name="local_path" required /></label>`,
      async (fd) => {
        const result = await api("propertyExt.media.add", {
          house_id: fd.get("house_id"),
          media_type: fd.get("media_type"),
          title: fd.get("title"),
          local_path: fd.get("local_path"),
        });
        toast(result.ok ? "媒体已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawMedia();
      }
    )
  );
  main.querySelector("[data-auction]")?.addEventListener("click", () =>
    openDialog(
      "拍卖资料",
      `<label class="full">房源<select name="house_id">${houseOptions}</select></label>
       <label>法院<input name="court_name" /></label>
       <label>案号<input name="case_no" /></label>
       <label>起拍价<input name="starting_price" type="number" min="0.01" step="0.01" required /></label>
       <label>保留价<input name="reserve_price" type="number" min="0" step="0.01" /></label>
       <label class="full">备注<input name="remark" /></label>`,
      async (fd) => {
        const saved = await api("propertyExt.auction.save", {
          house_id: fd.get("house_id"),
          court_name: fd.get("court_name"),
          case_no: fd.get("case_no"),
          starting_price: Number(fd.get("starting_price")),
          reserve_price: fd.get("reserve_price") || null,
          remark: fd.get("remark"),
        });
        if (!saved.ok) return toast(saved.message, "error");
        const activated = await api("propertyExt.auction.activate", {
          house_id: fd.get("house_id"),
        });
        toast(
          activated.ok ? "拍卖资料已启用" : activated.message,
          activated.ok ? "ok" : "error"
        );
      }
    )
  );
  main.querySelector("[data-exclusive]")?.addEventListener("click", () =>
    openDialog(
      "独家/包销",
      `<label class="full">房源<select name="house_id">${houseOptions}</select></label>
       <label>类型<select name="agency_type"><option value="exclusive">独家</option><option value="package">包销</option></select></label>
       <label>开始日期<input name="start_date" type="date" required /></label>
       <label>结束日期<input name="end_date" type="date" required /></label>
       <label>包销价<input name="package_price" type="number" min="0" step="0.01" /></label>
       <label class="full">佣金规则<input name="commission_rule" /></label>`,
      async (fd) => {
        const saved = await api("propertyExt.exclusive.save", {
          house_id: fd.get("house_id"),
          agency_type: fd.get("agency_type"),
          start_date: fd.get("start_date"),
          end_date: fd.get("end_date"),
          package_price: fd.get("package_price") || null,
          commission_rule: fd.get("commission_rule"),
        });
        if (!saved.ok) return toast(saved.message, "error");
        const activated = await api("propertyExt.exclusive.activate", {
          house_id: fd.get("house_id"),
        });
        toast(
          activated.ok ? "独家/包销已启用" : activated.message,
          activated.ok ? "ok" : "error"
        );
      }
    )
  );
  await Promise.all([drawLocks(), drawCoops(), drawMedia()]);
}

async function renderDealExt(main: HTMLElement) {
  const canManage = ["admin", "store_manager"].includes(state.user.role);
  const canWrite = state.user.role !== "finance";
  const options = await api("dealExt.options", {});
  const dealOptions = options.ok
    ? ((options.data as any).deals || [])
        .map(
          (deal: any) =>
            `<option value="${deal.id}">${deal.house_title} · ${deal.customer_name}</option>`
        )
        .join("")
    : "";
  const userOptions = options.ok
    ? ((options.data as any).users || [])
        .map((user: any) => `<option value="${user.id}">${user.display_name}</option>`)
        .join("")
    : "";
  main.innerHTML = `
    <div class="header"><h2>成交投诉与更名</h2><div class="ops">
      ${canWrite ? `<button class="btn ghost" data-new-complaint>登记投诉</button><button class="btn" data-new-rename>申请更名</button>` : ""}
    </div></div>
    <h3>成交投诉</h3>
    <div class="filters"><select data-complaint-status><option value="">全部状态</option><option value="open">待处理</option><option value="investigating">调查中</option><option value="resolved">已结案</option><option value="rejected">已驳回</option><option value="withdrawn">已撤回</option></select></div>
    <div class="list" data-complaints></div>
    <h3>成交更名</h3>
    <div class="filters"><select data-rename-status><option value="">全部状态</option><option value="draft">草稿</option><option value="submitted">待审批</option><option value="approved">已审批</option><option value="rejected">已驳回</option><option value="cancelled">已取消</option></select></div>
    <div class="list" data-renames></div>
  `;
  const drawComplaints = async () => {
    const status = (main.querySelector("[data-complaint-status]") as HTMLSelectElement).value;
    const result = await api("dealExt.complaints.list", status ? { status } : {});
    const list = main.querySelector("[data-complaints]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "resolved" ? "ok" : item.status === "rejected" || item.status === "withdrawn" ? "danger" : "warn"}">${item.status}</span><strong>${item.title}</strong> · ${item.house_title}</div>
            <div class="meta">${item.category} · ${item.customer_name} · 附件 ${item.attachment_count}${item.assignee_name ? ` · 处理人 ${item.assignee_name}` : ""}${item.resolution ? ` · ${item.resolution}` : ""}${item.reject_reason ? ` · ${item.reject_reason}` : ""}</div>
          </div><div class="ops">
            ${item.status === "open" && canWrite ? `<button class="btn danger" data-withdraw-complaint="${item.id}">撤回</button>` : ""}
            ${item.status === "open" && canManage ? `<button class="btn" data-investigate="${item.id}">开始调查</button><button class="btn danger" data-reject-complaint="${item.id}">驳回</button>` : ""}
            ${item.status === "investigating" && (canManage || item.assignee_user_id === state.user.id) ? `<button class="btn ghost" data-complaint-attach="${item.id}">上传凭证</button><button class="btn" data-resolve="${item.id}">结案</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无成交投诉</div>`;
    list.querySelectorAll("[data-investigate]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "开始调查",
          `<label>处理人<select name="assignee_user_id">${userOptions}</select></label>`,
          async (fd) => {
            const updated = await api("dealExt.complaints.investigate", {
              id: (button as HTMLElement).dataset.investigate,
              assignee_user_id: fd.get("assignee_user_id"),
            });
            toast(updated.ok ? "已进入调查" : updated.message, updated.ok ? "ok" : "error");
            if (updated.ok) drawComplaints();
          }
        )
      )
    );
    list.querySelectorAll("[data-complaint-attach]").forEach((button) =>
      button.addEventListener("click", async () => {
        const localPath = prompt("本地处理凭证路径");
        if (!localPath) return;
        const uploaded = await api("attachment.add", {
          parent_type: "deal_complaint",
          parent_id: (button as HTMLElement).dataset.complaintAttach,
          category: "complaint_evidence",
          name: "投诉凭证.pdf",
          local_path: localPath,
        });
        toast(uploaded.ok ? "凭证已上传" : uploaded.message, uploaded.ok ? "ok" : "error");
        if (uploaded.ok) drawComplaints();
      })
    );
    list.querySelectorAll("[data-resolve]").forEach((button) =>
      button.addEventListener("click", () =>
        openDialog(
          "结案",
          `<label class="full">处理结果<input name="resolution" required /></label>`,
          async (fd) => {
            const updated = await api("dealExt.complaints.resolve", {
              id: (button as HTMLElement).dataset.resolve,
              resolution: fd.get("resolution"),
            });
            toast(updated.ok ? "投诉已结案" : updated.message, updated.ok ? "ok" : "error");
            if (updated.ok) drawComplaints();
          }
        )
      )
    );
    list.querySelectorAll("[data-reject-complaint]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("驳回原因");
        if (!reason) return;
        const updated = await api("dealExt.complaints.reject", {
          id: (button as HTMLElement).dataset.rejectComplaint,
          reason,
        });
        toast(updated.ok ? "投诉已驳回" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawComplaints();
      })
    );
    list.querySelectorAll("[data-withdraw-complaint]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("撤回原因");
        if (!reason) return;
        const updated = await api("dealExt.complaints.withdraw", {
          id: (button as HTMLElement).dataset.withdrawComplaint,
          reason,
        });
        toast(updated.ok ? "投诉已撤回" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawComplaints();
      })
    );
  };
  const drawRenames = async () => {
    const status = (main.querySelector("[data-rename-status]") as HTMLSelectElement).value;
    const result = await api("dealExt.renames.list", status ? { status } : {});
    const list = main.querySelector("[data-renames]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "approved" ? "ok" : item.status === "rejected" || item.status === "cancelled" ? "danger" : "warn"}">${item.status}</span><strong>${item.house_title}</strong> · ${item.target}</div>
            <div class="meta">${item.new_customer_name ? `客户 ${item.old_customer_name}→${item.new_customer_name}` : ""}${item.new_owner_name ? ` · 业主 ${item.old_owner_name}→${item.new_owner_name}` : ""} · 附件 ${item.attachment_count}${item.reject_reason ? ` · ${item.reject_reason}` : ""}</div>
          </div><div class="ops">
            ${["draft", "rejected"].includes(item.status) && canWrite ? `<button class="btn ghost" data-rename-attach="${item.id}">上传证明</button><button class="btn" data-submit-rename="${item.id}">提交</button><button class="btn danger" data-cancel-rename="${item.id}">取消</button>` : ""}
            ${item.status === "submitted" && canManage ? `<button class="btn" data-approve-rename="${item.id}">审批</button><button class="btn danger" data-reject-rename="${item.id}">驳回</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无成交更名</div>`;
    list.querySelectorAll("[data-rename-attach]").forEach((button) =>
      button.addEventListener("click", async () => {
        const localPath = prompt("本地更名证明路径");
        if (!localPath) return;
        const uploaded = await api("attachment.add", {
          parent_type: "deal_rename",
          parent_id: (button as HTMLElement).dataset.renameAttach,
          category: "rename_evidence",
          name: "更名证明.pdf",
          local_path: localPath,
        });
        toast(uploaded.ok ? "证明已上传" : uploaded.message, uploaded.ok ? "ok" : "error");
        if (uploaded.ok) drawRenames();
      })
    );
    list.querySelectorAll("[data-submit-rename]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("dealExt.renames.submit", {
          id: (button as HTMLElement).dataset.submitRename,
        });
        toast(updated.ok ? "更名已提交" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawRenames();
      })
    );
    list.querySelectorAll("[data-approve-rename]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("dealExt.renames.approve", {
          id: (button as HTMLElement).dataset.approveRename,
        });
        toast(updated.ok ? "更名已审批并生效" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawRenames();
      })
    );
    list.querySelectorAll("[data-reject-rename]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("驳回原因");
        if (!reason) return;
        const updated = await api("dealExt.renames.reject", {
          id: (button as HTMLElement).dataset.rejectRename,
          reason,
        });
        toast(updated.ok ? "更名已驳回" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawRenames();
      })
    );
    list.querySelectorAll("[data-cancel-rename]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("取消原因");
        if (!reason) return;
        const updated = await api("dealExt.renames.cancel", {
          id: (button as HTMLElement).dataset.cancelRename,
          reason,
        });
        toast(updated.ok ? "更名已取消" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawRenames();
      })
    );
  };
  main.querySelector("[data-new-complaint]")?.addEventListener("click", () =>
    openDialog(
      "登记成交投诉",
      `<label class="full">成交单<select name="deal_id">${dealOptions}</select></label>
       <label>分类<select name="category"><option value="commission">佣金</option><option value="service">服务</option><option value="document">资料</option><option value="payment">收付款</option><option value="other">其他</option></select></label>
       <label>标题<input name="title" required /></label>
       <label class="full">说明<textarea name="description" required></textarea></label>`,
      async (fd) => {
        const result = await api("dealExt.complaints.create", {
          deal_id: fd.get("deal_id"),
          category: fd.get("category"),
          title: fd.get("title"),
          description: fd.get("description"),
        });
        toast(result.ok ? "投诉已登记" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawComplaints();
      }
    )
  );
  main.querySelector("[data-new-rename]")?.addEventListener("click", () =>
    openDialog(
      "申请成交更名",
      `<label class="full">成交单<select name="deal_id">${dealOptions}</select></label>
       <label>更名对象<select name="target"><option value="customer">客户</option><option value="owner">业主</option><option value="both">双方</option></select></label>
       <label>新客户姓名<input name="new_customer_name" /></label>
       <label>新业主姓名<input name="new_owner_name" /></label>
       <label class="full">原因<input name="reason" required /></label>`,
      async (fd) => {
        const result = await api("dealExt.renames.create", {
          deal_id: fd.get("deal_id"),
          target: fd.get("target"),
          new_customer_name: fd.get("new_customer_name"),
          new_owner_name: fd.get("new_owner_name"),
          reason: fd.get("reason"),
        });
        toast(result.ok ? "更名草稿已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawRenames();
      }
    )
  );
  main.querySelector("[data-complaint-status]")!.addEventListener("change", drawComplaints);
  main.querySelector("[data-rename-status]")!.addEventListener("change", drawRenames);
  await Promise.all([drawComplaints(), drawRenames()]);
}

async function renderOfficeCollab(main: HTMLElement) {
  const canManage = ["admin", "store_manager"].includes(state.user.role);
  const options = await api("officeCollab.options", {});
  const userOptions = options.ok
    ? ((options.data as any).users || [])
        .filter((user: any) => user.id !== state.user.id)
        .map((user: any) => `<option value="${user.id}">${user.display_name}</option>`)
        .join("")
    : "";
  main.innerHTML = `
    <div class="header"><h2>办公协同</h2><div class="ops">
      ${canManage ? `<button class="btn ghost" data-exam>发布考试</button><button class="btn ghost" data-event>创建活动</button>` : ""}
      <button class="btn ghost" data-workflow>发起会签</button>
      <button class="btn ghost" data-ticket>申领票据</button>
      <button class="btn ghost" data-summary>写总结</button>
      <button class="btn ghost" data-circle>发同事圈</button>
      <button class="btn" data-call>登记来电</button>
    </div></div>
    <h3>考试</h3><div class="list" data-exams></div>
    <h3>活动</h3><div class="list" data-events></div>
    <h3>会签</h3><div class="list" data-workflows></div>
    <h3>票据</h3><div class="list" data-tickets></div>
    <h3>工作总结</h3><div class="list" data-summaries></div>
    <h3>同事圈</h3><div class="list" data-circle></div>
    <h3>来电</h3><div class="list" data-calls></div>
  `;
  const drawExams = async () => {
    const result = await api("officeCollab.exams.list", {});
    const list = main.querySelector("[data-exams]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "published" ? "ok" : "warn"}">${item.status}</span><strong>${item.title}</strong></div>
            <div class="meta">及格 ${item.pass_score} · ${item.duration_minutes} 分钟 · 参考 ${item.attempt_count}</div>
          </div><div class="ops">
            ${canManage && item.status === "draft" ? `<button class="btn" data-publish-exam="${item.id}">发布</button>` : ""}
            ${item.status === "published" ? `<button class="btn" data-attempt-exam="${item.id}">提交成绩</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无考试</div>`;
    list.querySelectorAll("[data-publish-exam]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.exams.publish", {
          id: (button as HTMLElement).dataset.publishExam,
        });
        toast(updated.ok ? "考试已发布" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawExams();
      })
    );
    list.querySelectorAll("[data-attempt-exam]").forEach((button) =>
      button.addEventListener("click", async () => {
        const score = prompt("本次成绩（0-100）");
        if (score == null) return;
        const updated = await api("officeCollab.exams.attempt", {
          exam_id: (button as HTMLElement).dataset.attemptExam,
          score: Number(score),
        });
        toast(updated.ok ? "成绩已提交" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawExams();
      })
    );
  };
  const drawEvents = async () => {
    const result = await api("officeCollab.events.list", {});
    const list = main.querySelector("[data-events]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "open" ? "ok" : "warn"}">${item.status}</span><strong>${item.title}</strong></div>
            <div class="meta">${item.location || "未定地点"} · 报名 ${item.signup_count}${item.capacity != null ? `/${item.capacity}` : ""}</div>
          </div><div class="ops">
            ${canManage && item.status === "draft" ? `<button class="btn" data-open-event="${item.id}">开放报名</button>` : ""}
            ${item.status === "open" ? `<button class="btn" data-signup-event="${item.id}">报名</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无活动</div>`;
    list.querySelectorAll("[data-open-event]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.events.open", {
          id: (button as HTMLElement).dataset.openEvent,
        });
        toast(updated.ok ? "已开放报名" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawEvents();
      })
    );
    list.querySelectorAll("[data-signup-event]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.events.signup", {
          id: (button as HTMLElement).dataset.signupEvent,
        });
        toast(updated.ok ? "报名成功" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawEvents();
      })
    );
  };
  const drawWorkflows = async () => {
    const result = await api("officeCollab.workflows.list", {});
    const list = main.querySelector("[data-workflows]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "approved" ? "ok" : item.status === "rejected" ? "danger" : "warn"}">${item.status}</span><strong>${item.title}</strong></div>
            <div class="meta">${item.created_by_name} · 会签 ${item.approved_count}/${item.approver_count}${item.reject_reason ? ` · ${item.reject_reason}` : ""}</div>
          </div><div class="ops">
            ${item.status === "draft" && item.created_by === state.user.id ? `<button class="btn" data-submit-workflow="${item.id}">提交</button>` : ""}
            ${item.status === "pending" ? `<button class="btn" data-approve-workflow="${item.id}">同意</button><button class="btn danger" data-reject-workflow="${item.id}">驳回</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无会签</div>`;
    list.querySelectorAll("[data-submit-workflow]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.workflows.submit", {
          id: (button as HTMLElement).dataset.submitWorkflow,
        });
        toast(updated.ok ? "会签已提交" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawWorkflows();
      })
    );
    list.querySelectorAll("[data-approve-workflow]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.workflows.decide", {
          id: (button as HTMLElement).dataset.approveWorkflow,
          decision: "approved",
        });
        toast(updated.ok ? "已同意" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawWorkflows();
      })
    );
    list.querySelectorAll("[data-reject-workflow]").forEach((button) =>
      button.addEventListener("click", async () => {
        const comment = prompt("驳回意见");
        if (!comment) return;
        const updated = await api("officeCollab.workflows.decide", {
          id: (button as HTMLElement).dataset.rejectWorkflow,
          decision: "rejected",
          comment,
        });
        toast(updated.ok ? "已驳回" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawWorkflows();
      })
    );
  };
  const drawTickets = async () => {
    const result = await api("officeCollab.tickets.list", {});
    const list = main.querySelector("[data-tickets]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "issued" || item.status === "returned" ? "ok" : "warn"}">${item.status}</span><strong>${item.title}</strong> · x${item.quantity}</div>
            <div class="meta">${item.ticket_type} · ${item.applicant_name}</div>
          </div><div class="ops">
            ${canManage && item.status === "requested" ? `<button class="btn" data-approve-ticket="${item.id}">批准</button>` : ""}
            ${canManage && item.status === "approved" ? `<button class="btn" data-issue-ticket="${item.id}">发放</button>` : ""}
            ${item.status === "issued" ? `<button class="btn danger" data-return-ticket="${item.id}">回收</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无票据</div>`;
    list.querySelectorAll("[data-approve-ticket]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.tickets.approve", {
          id: (button as HTMLElement).dataset.approveTicket,
        });
        toast(updated.ok ? "已批准" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawTickets();
      })
    );
    list.querySelectorAll("[data-issue-ticket]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.tickets.issue", {
          id: (button as HTMLElement).dataset.issueTicket,
        });
        toast(updated.ok ? "已发放" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawTickets();
      })
    );
    list.querySelectorAll("[data-return-ticket]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.tickets.return", {
          id: (button as HTMLElement).dataset.returnTicket,
        });
        toast(updated.ok ? "已回收" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawTickets();
      })
    );
  };
  const drawSummaries = async () => {
    const result = await api("officeCollab.summaries.list", {});
    const list = main.querySelector("[data-summaries]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "reviewed" ? "ok" : "warn"}">${item.status}</span><strong>${item.user_name}</strong> · ${item.period_start}~${item.period_end}</div>
            <div class="meta">${item.content.slice(0, 60)}${item.review_comment ? ` · 评阅：${item.review_comment}` : ""}</div>
          </div><div class="ops">
            ${item.status === "draft" && item.user_id === state.user.id ? `<button class="btn" data-submit-summary="${item.id}">提交</button>` : ""}
            ${canManage && item.status === "submitted" ? `<button class="btn" data-review-summary="${item.id}">评阅</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无工作总结</div>`;
    list.querySelectorAll("[data-submit-summary]").forEach((button) =>
      button.addEventListener("click", async () => {
        const updated = await api("officeCollab.summaries.submit", {
          id: (button as HTMLElement).dataset.submitSummary,
        });
        toast(updated.ok ? "总结已提交" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawSummaries();
      })
    );
    list.querySelectorAll("[data-review-summary]").forEach((button) =>
      button.addEventListener("click", async () => {
        const comment = prompt("评阅意见");
        if (!comment) return;
        const updated = await api("officeCollab.summaries.review", {
          id: (button as HTMLElement).dataset.reviewSummary,
          comment,
        });
        toast(updated.ok ? "已评阅" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawSummaries();
      })
    );
  };
  const drawCircle = async () => {
    const result = await api("officeCollab.circle.list", {});
    const list = main.querySelector("[data-circle]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag ${item.status === "published" ? "ok" : "danger"}">${item.status}</span><strong>${item.author_name}</strong></div>
            <div class="meta">${item.content}</div>
          </div><div class="ops">
            ${canManage && item.status === "published" ? `<button class="btn danger" data-hide-circle="${item.id}">隐藏</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无同事圈动态</div>`;
    list.querySelectorAll("[data-hide-circle]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("隐藏原因");
        if (!reason) return;
        const updated = await api("officeCollab.circle.hide", {
          id: (button as HTMLElement).dataset.hideCircle,
          reason,
        });
        toast(updated.ok ? "已隐藏" : updated.message, updated.ok ? "ok" : "error");
        if (updated.ok) drawCircle();
      })
    );
  };
  const drawCalls = async () => {
    const result = await api("officeCollab.calls.list", {});
    const list = main.querySelector("[data-calls]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    list.innerHTML =
      (result.data as any[])
        .map(
          (item) => `<div class="row"><div>
            <div><span class="tag">${item.direction === "in" ? "来电" : "去电"}</span><strong>${item.phone}</strong></div>
            <div class="meta">${item.created_by_name}${item.customer_name ? ` · 客 ${item.customer_name}` : ""}${item.house_title ? ` · 房 ${item.house_title}` : ""}${item.note ? ` · ${item.note}` : ""}</div>
          </div></div>`
        )
        .join("") || `<div class="empty">暂无来电记录</div>`;
  };
  main.querySelector("[data-exam]")?.addEventListener("click", () =>
    openDialog(
      "创建考试",
      `<label class="full">标题<input name="title" required /></label>
       <label>及格分<input name="pass_score" type="number" min="0" max="100" value="60" /></label>
       <label>时长(分)<input name="duration_minutes" type="number" min="1" max="600" value="60" /></label>
       <label class="full">说明<input name="description" /></label>`,
      async (fd) => {
        const result = await api("officeCollab.exams.save", {
          title: fd.get("title"),
          pass_score: Number(fd.get("pass_score")),
          duration_minutes: Number(fd.get("duration_minutes")),
          description: fd.get("description"),
        });
        toast(result.ok ? "考试草稿已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawExams();
      }
    )
  );
  main.querySelector("[data-event]")?.addEventListener("click", () =>
    openDialog(
      "创建活动",
      `<label class="full">标题<input name="title" required /></label>
       <label>开始<input name="start_at" type="datetime-local" required /></label>
       <label>结束<input name="end_at" type="datetime-local" required /></label>
       <label>地点<input name="location" /></label>
       <label>名额<input name="capacity" type="number" min="1" /></label>`,
      async (fd) => {
        const result = await api("officeCollab.events.save", {
          title: fd.get("title"),
          start_at: new Date(String(fd.get("start_at"))).toISOString(),
          end_at: new Date(String(fd.get("end_at"))).toISOString(),
          location: fd.get("location"),
          capacity: fd.get("capacity") || null,
        });
        toast(result.ok ? "活动草稿已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawEvents();
      }
    )
  );
  main.querySelector("[data-workflow]")?.addEventListener("click", () =>
    openDialog(
      "发起会签",
      `<label class="full">标题<input name="title" required /></label>
       <label class="full">内容<textarea name="content" required></textarea></label>
       <label class="full">会签人<select name="approver_user_id" required>${userOptions}</select></label>`,
      async (fd) => {
        const result = await api("officeCollab.workflows.create", {
          title: fd.get("title"),
          content: fd.get("content"),
          approver_user_ids: [String(fd.get("approver_user_id"))],
        });
        toast(result.ok ? "会签草稿已创建" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawWorkflows();
      }
    )
  );
  main.querySelector("[data-ticket]")?.addEventListener("click", () =>
    openDialog(
      "申领票据",
      `<label>类型<select name="ticket_type"><option value="receipt">收据</option><option value="invoice">发票</option><option value="contract_blank">空白合同</option><option value="other">其他</option></select></label>
       <label>数量<input name="quantity" type="number" min="1" value="1" required /></label>
       <label class="full">标题<input name="title" required /></label>`,
      async (fd) => {
        const result = await api("officeCollab.tickets.create", {
          ticket_type: fd.get("ticket_type"),
          quantity: Number(fd.get("quantity")),
          title: fd.get("title"),
        });
        toast(result.ok ? "申领已提交" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawTickets();
      }
    )
  );
  main.querySelector("[data-summary]")?.addEventListener("click", () =>
    openDialog(
      "工作总结",
      `<label>开始日期<input name="period_start" type="date" required /></label>
       <label>结束日期<input name="period_end" type="date" required /></label>
       <label class="full">内容<textarea name="content" required></textarea></label>`,
      async (fd) => {
        const result = await api("officeCollab.summaries.save", {
          period_start: fd.get("period_start"),
          period_end: fd.get("period_end"),
          content: fd.get("content"),
        });
        toast(result.ok ? "总结草稿已保存" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawSummaries();
      }
    )
  );
  main.querySelector("[data-circle]")?.addEventListener("click", () =>
    openDialog(
      "发同事圈",
      `<label class="full">内容<textarea name="content" required></textarea></label>`,
      async (fd) => {
        const result = await api("officeCollab.circle.create", {
          content: fd.get("content"),
        });
        toast(result.ok ? "已发布" : result.message, result.ok ? "ok" : "error");
        if (result.ok) drawCircle();
      }
    )
  );
  main.querySelector("[data-call]")?.addEventListener("click", () =>
    openDialog(
      "登记来电",
      `<label>号码<input name="phone" required placeholder="11位手机号" /></label>
       <label>方向<select name="direction"><option value="in">来电</option><option value="out">去电</option></select></label>
       <label class="full">备注<input name="note" /></label>`,
      async (fd) => {
        const result = await api("officeCollab.calls.create", {
          phone: fd.get("phone"),
          direction: fd.get("direction"),
          note: fd.get("note"),
          called_at: new Date().toISOString(),
        });
        toast(
          result.ok
            ? `已登记${(result.data as any).matched_customer_id ? "并匹配客源" : ""}${(result.data as any).matched_house_id ? "并匹配房源" : ""}`
            : result.message,
          result.ok ? "ok" : "error"
        );
        if (result.ok) drawCalls();
      }
    )
  );
  await Promise.all([
    drawExams(),
    drawEvents(),
    drawWorkflows(),
    drawTickets(),
    drawSummaries(),
    drawCircle(),
    drawCalls(),
  ]);
}

async function renderSystemCenter(main: HTMLElement) {
  const canManageSystem = ["admin", "store_manager"].includes(state.user.role);
  const desktopShell = (window as any).weilaijia?.shell;
  const blacklist = canManageSystem
    ? await api("blacklist.list", {})
    : ({ ok: true, data: [] } as any);
  const integrations =
    state.user.role === "admin" ? await api("integration.list", {}) : ({ ok: true, data: [] } as any);
  const backups =
    state.user.role === "admin"
      ? await api("system.backup.list", {})
      : ({ ok: true, data: [] } as any);
  const dictionaries =
    state.user.role === "admin"
      ? await api("config.dictionary.list", {})
      : ({ ok: true, data: [] } as any);
  const templates =
    state.user.role === "admin"
      ? await api("contract.templates", {})
      : ({ ok: true, data: [] } as any);
  const documentTemplates =
    state.user.role === "admin"
      ? await api("deal.documents.templates", {})
      : ({ ok: true, data: [] } as any);
  const transferTemplates =
    state.user.role === "admin"
      ? await api("transfer.templates.list", {})
      : ({ ok: true, data: [] } as any);
  main.innerHTML = `
    <div class="header"><h2>系统中心</h2><div class="ops">
      ${canManageSystem ? `<button class="btn ghost" data-blacklist>添加黑名单</button>` : ""}
      <button class="btn ghost" data-password>修改密码</button>
      <button class="btn ghost" data-preferences>界面偏好</button>
      ${state.user.role === "admin" ? `<button class="btn ghost" data-settings>业务参数</button><button class="btn ghost" data-tiers>提成阶梯</button><button class="btn ghost" data-dictionary>数据字典</button><button class="btn ghost" data-template>合同模板</button><button class="btn ghost" data-doc-template>资料清单</button><button class="btn ghost" data-transfer-template>过户模板</button>` : ""}
      ${desktopShell ? `<button class="btn ghost" data-screenshot>截图</button><button class="btn ghost" data-fullscreen>全屏</button><button class="btn ghost" data-clear-cache>清缓存</button>` : ""}
      ${state.user.role === "admin" ? `<button class="btn ghost" data-permission>功能权限</button><button class="btn ghost" data-backup>立即备份</button>` : ""}
      ${state.user.role === "admin" ? `<button class="btn" data-integration>配置适配器</button>` : ""}
    </div></div>
    ${canManageSystem ? `<h3>业务黑名单</h3><div class="list" data-blacklist-list></div>` : ""}
    ${state.user.role === "admin" ? `<h3>数据库备份</h3><div class="list" data-backups></div>` : ""}
    ${state.user.role === "admin" ? `<h3>数据字典</h3><div class="list" data-dictionaries></div><h3>合同模板</h3><div class="list" data-templates></div><h3>交易资料模板</h3><div class="list" data-document-templates></div><h3>过户节点模板</h3><div class="list" data-transfer-templates></div>` : ""}
    ${state.user.role === "admin" ? `<h3>第三方适配器（默认关闭）</h3><div class="list" data-integrations></div>` : ""}
  `;
  const blacklistList = main.querySelector("[data-blacklist-list]");
  if (blacklistList) {
    blacklistList.innerHTML =
      blacklist.ok && (blacklist.data as any[]).length
        ? (blacklist.data as any[])
            .map(
              (item) =>
                `<div class="row"><div><strong>${item.display_value}</strong><div class="meta">${item.kind} · ${item.reason}</div></div></div>`
            )
            .join("")
        : `<div class="empty">暂无黑名单</div>`;
  }
  const integrationList = main.querySelector("[data-integrations]");
  if (integrationList) {
    integrationList.innerHTML = ((integrations.data as any[]) || [])
      .map(
        (item) =>
          `<div class="row"><div><strong>${item.provider}</strong><div class="meta">${item.enabled ? "已配置" : "未配置"} · ${item.mode} · ${item.health_status}</div></div></div>`
      )
      .join("");
  }
  const backupList = main.querySelector("[data-backups]");
  if (backupList) {
    backupList.innerHTML = ((backups.data as any[]) || []).length
      ? ((backups.data as any[]) || [])
          .map(
            (item) =>
              `<div class="row"><div><strong>${item.filename}</strong><div class="meta">${money(item.size)} bytes · ${item.created_at}</div></div></div>`
          )
          .join("")
      : `<div class="empty">暂无备份</div>`;
  }
  const dictionaryList = main.querySelector("[data-dictionaries]");
  if (dictionaryList) {
    dictionaryList.innerHTML = (dictionaries.data as any[]).length
      ? (dictionaries.data as any[])
          .map(
            (item) =>
              `<div class="row"><div><strong>${item.label}</strong><div class="meta">${item.dict_type} · ${item.value}</div></div></div>`
          )
          .join("")
      : `<div class="empty">暂无自定义字典</div>`;
  }
  const templateList = main.querySelector("[data-templates]");
  if (templateList) {
    templateList.innerHTML = (templates.data as any[]).length
      ? (templates.data as any[])
          .map(
            (item) =>
              `<div class="row"><div><strong>${item.name}</strong><div class="meta">${item.deal_type === "sale" ? "买卖" : "租赁"} · ${item.content.slice(0, 80)}</div></div></div>`
          )
          .join("")
      : `<div class="empty">暂无合同模板</div>`;
  }
  const documentTemplateList = main.querySelector("[data-document-templates]");
  if (documentTemplateList) {
    documentTemplateList.innerHTML = (documentTemplates.data as any[]).length
      ? (documentTemplates.data as any[])
          .map(
            (item) =>
              `<div class="row"><div><strong>${item.label}</strong><div class="meta">${item.deal_type} · ${item.category} · ${item.required ? "必传" : "选传"}</div></div></div>`
          )
          .join("")
      : `<div class="empty">暂无交易资料模板</div>`;
  }
  const transferTemplateList = main.querySelector("[data-transfer-templates]");
  if (transferTemplateList) {
    transferTemplateList.innerHTML = (transferTemplates.data as any[]).length
      ? (transferTemplates.data as any[])
          .map(
            (item) =>
              `<div class="row"><div><strong>${item.title}</strong><div class="meta">${item.deal_type} · ${item.node_type} · 默认 ${item.default_assignee_role || "不指派"}</div></div></div>`
          )
          .join("")
      : `<div class="empty">暂无过户节点模板</div>`;
  }
  const blacklistButton = main.querySelector("[data-blacklist]");
  if (blacklistButton) {
    blacklistButton.addEventListener("click", () => {
      openDialog(
        "添加业务黑名单",
        `
        <label>类型<select name="kind"><option value="phone">电话</option><option value="id_card">身份证</option><option value="lead">商机</option></select></label>
        <label>值<input name="value" required /></label>
        <label class="full">原因<input name="reason" required /></label>
        `,
        async (fd) => {
          const result = await api("blacklist.add", {
            kind: fd.get("kind"),
            value: fd.get("value"),
            reason: fd.get("reason"),
          });
          toast(result.ok ? "黑名单已添加" : result.message, result.ok ? "ok" : "error");
        }
      );
    });
  }
  const integrationButton = main.querySelector("[data-integration]");
  if (integrationButton) {
    integrationButton.addEventListener("click", () => {
      openDialog(
        "配置第三方适配器",
        `
        <label>服务<select name="provider"><option value="ca_esign">CA电子签</option><option value="virtual_number">真隐号</option><option value="external_listing">外网房源平台</option><option value="map">地图</option><option value="wechat">微信</option><option value="sms">短信</option></select></label>
        <label><span><input name="enabled" type="checkbox" /> 启用</span></label>
        <label class="full">HTTPS 地址<input name="endpoint" placeholder="https://api.example.com" /></label>
        <label>凭据引用<input name="credential_ref" placeholder="环境变量/密钥管理器引用" /></label>
        <label>租户引用<input name="tenant_ref" /></label>
        `,
        async (fd) => {
          const result = await api("integration.configure", {
            provider: fd.get("provider"),
            enabled: fd.get("enabled") === "on",
            endpoint: fd.get("endpoint"),
            credential_ref: fd.get("credential_ref"),
            tenant_ref: fd.get("tenant_ref"),
          });
          toast(result.ok ? "适配器配置已保存" : result.message, result.ok ? "ok" : "error");
        }
      );
    });
  }
  main.querySelector("[data-password]")!.addEventListener("click", () => {
    openDialog(
      "修改密码",
      `
      <label class="full">当前密码<input name="current_password" type="password" required /></label>
      <label class="full">新密码（至少8位）<input name="new_password" type="password" minlength="8" required /></label>
      `,
      async (fd) => {
        const result = await api("auth.changePassword", {
          current_password: fd.get("current_password"),
          new_password: fd.get("new_password"),
        });
        toast(result.ok ? "密码已修改，请重新登录" : result.message, result.ok ? "ok" : "error");
        if (result.ok) {
          state.token = "";
          state.user = null;
          localStorage.removeItem("weilaijia.token");
        }
      }
    );
  });
  const backupButton = main.querySelector("[data-backup]");
  if (backupButton) {
    backupButton.addEventListener("click", async () => {
      const result = await api("system.backup.create");
      toast(
        result.ok ? `备份已创建：${(result.data as any).filename}` : result.message,
        result.ok ? "ok" : "error"
      );
      if (result.ok) render();
    });
  }
  const permissionButton = main.querySelector("[data-permission]");
  if (permissionButton) {
    permissionButton.addEventListener("click", () => {
      openDialog(
        "设置功能权限",
        `
        <label>角色<select name="role"><option value="agent">经纪人</option><option value="store_manager">店长</option><option value="finance">财务</option></select></label>
        <label>功能<input name="feature" placeholder="如 report.*" required /></label>
        <label><span><input name="allowed" type="checkbox" checked /> 允许</span></label>
        `,
        async (fd) => {
          const result = await api("permission.set", {
            role: fd.get("role"),
            feature: fd.get("feature"),
            allowed: fd.get("allowed") === "on",
          });
          toast(result.ok ? "功能权限已更新" : result.message, result.ok ? "ok" : "error");
        }
      );
    });
  }
  const screenshotButton = main.querySelector("[data-screenshot]");
  if (screenshotButton) {
    screenshotButton.addEventListener("click", async () => {
      const result = await desktopShell.screenshot();
      toast(`截图已保存：${result.filename}`);
    });
  }
  const fullscreenButton = main.querySelector("[data-fullscreen]");
  if (fullscreenButton) {
    fullscreenButton.addEventListener("click", async () => {
      await desktopShell.toggleFullscreen();
    });
  }
  const clearCacheButton = main.querySelector("[data-clear-cache]");
  if (clearCacheButton) {
    clearCacheButton.addEventListener("click", async () => {
      await desktopShell.clearCache();
    });
  }
  main.querySelector("[data-preferences]")!.addEventListener("click", async () => {
    const current = await api("config.preferences.get");
    if (!current.ok) return toast(current.message, "error");
    const pref = current.data as any;
    openDialog(
      "界面偏好",
      `
      <label>列表密度<select name="list_density"><option value="comfortable" ${pref.list_density === "comfortable" ? "selected" : ""}>舒适</option><option value="compact" ${pref.list_density === "compact" ? "selected" : ""}>紧凑</option></select></label>
      <label>主题<select name="theme"><option value="light" ${pref.theme === "light" ? "selected" : ""}>浅色</option><option value="dark" ${pref.theme === "dark" ? "selected" : ""}>深色</option><option value="system" ${pref.theme === "system" ? "selected" : ""}>跟随系统</option></select></label>
      <label><span><input name="watermark_enabled" type="checkbox" ${pref.watermark_enabled ? "checked" : ""} /> 开启水印</span></label>
      `,
      async (fd) => {
        const result = await api("config.preferences.save", {
          list_density: fd.get("list_density"),
          theme: fd.get("theme"),
          watermark_enabled: fd.get("watermark_enabled") === "on",
        });
        toast(result.ok ? "偏好已保存" : result.message, result.ok ? "ok" : "error");
        if (result.ok) applyPreferences(result.data);
      }
    );
  });
  const settingsButton = main.querySelector("[data-settings]");
  if (settingsButton) {
    settingsButton.addEventListener("click", async () => {
      const current = await api("config.settings.get");
      if (!current.ok) return toast(current.message, "error");
      const value = current.data as any;
      openDialog(
        "业务参数",
        `
        <label>个人持盘上限<input name="house_hold_limit" type="number" value="${value.house_hold_limit}" /></label>
        <label>店长管理奖比例<input name="manager_award_rate" type="number" step="0.01" value="${value.manager_award_rate}" /></label>
        <label>密码最小长度<input name="password_min_length" type="number" value="${value.password_min_length}" /></label>
        <label>房源角色保护期（天）<input name="house_role_protection_days" type="number" min="0" max="365" value="${value.house_role_protection_days}" /></label>
        <label><span><input name="deal_doc_required" type="checkbox" ${value.deal_doc_required ? "checked" : ""} /> 提交成交前强制资料齐全</span></label>
        <label><span><input name="force_follow_before_phone" type="checkbox" ${value.force_follow_before_phone ? "checked" : ""} /> 经纪人查看电话前强制写跟进</span></label>
        <label><span><input name="non_holder_view_remind" type="checkbox" ${value.non_holder_view_remind ? "checked" : ""} /> 非接盘人带看提醒接盘人</span></label>
        <label class="full">成交必录字段（逗号分隔）<input name="deal_required_fields" value="${value.deal_required_fields.join(",")}" placeholder="loan_bank,loan_amount" /></label>
        `,
        async (fd) => {
          const result = await api("config.settings.save", {
            house_hold_limit: Number(fd.get("house_hold_limit")),
            manager_award_rate: Number(fd.get("manager_award_rate")),
            password_min_length: Number(fd.get("password_min_length")),
            house_role_protection_days: Number(fd.get("house_role_protection_days")),
            deal_doc_required: fd.get("deal_doc_required") === "on",
            force_follow_before_phone: fd.get("force_follow_before_phone") === "on",
            non_holder_view_remind: fd.get("non_holder_view_remind") === "on",
            deal_required_fields: String(fd.get("deal_required_fields") || "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          });
          toast(result.ok ? "业务参数已保存" : result.message, result.ok ? "ok" : "error");
        }
      );
    });
  }
  const tierButton = main.querySelector("[data-tiers]");
  if (tierButton) {
    tierButton.addEventListener("click", async () => {
      const current = await api("config.commissionTiers.list");
      const summary =
        current.ok && (current.data as any[]).length
          ? (current.data as any[])
              .map((tier) => `${tier.min_amount}～${tier.max_amount ?? "以上"}：${tier.pool_rate * 100}%`)
              .join("；")
          : "当前无阶梯，使用公司默认比例";
      openDialog(
        `新增提成阶梯（${summary}）`,
        `
        <label>佣金下限<input name="min_amount" type="number" min="0" required /></label>
        <label>佣金上限<input name="max_amount" type="number" min="0" /></label>
        <label>经纪人池比例<input name="pool_rate" type="number" min="0.01" max="1" step="0.01" required /></label>
        `,
        async (fd) => {
          const result = await api("config.commissionTiers.save", {
            min_amount: Number(fd.get("min_amount")),
            max_amount: fd.get("max_amount") ? Number(fd.get("max_amount")) : null,
            pool_rate: Number(fd.get("pool_rate")),
          });
          toast(result.ok ? "提成阶梯已保存" : result.message, result.ok ? "ok" : "error");
        }
      );
    });
  }
  const dictionaryButton = main.querySelector("[data-dictionary]");
  if (dictionaryButton) {
    dictionaryButton.addEventListener("click", () => {
      openDialog(
        "新增数据字典项",
        `
        <label>字典类型<input name="dict_type" placeholder="source / follow_method" required /></label>
        <label>值<input name="value" required /></label>
        <label>显示名称<input name="label" required /></label>
        <label>排序<input name="sort_order" type="number" value="0" /></label>
        `,
        async (fd) => {
          const result = await api("config.dictionary.upsert", {
            dict_type: fd.get("dict_type"),
            value: fd.get("value"),
            label: fd.get("label"),
            sort_order: Number(fd.get("sort_order")),
          });
          toast(result.ok ? "字典项已保存" : result.message, result.ok ? "ok" : "error");
          if (result.ok) render();
        }
      );
    });
  }
  const templateButton = main.querySelector("[data-template]");
  if (templateButton) {
    templateButton.addEventListener("click", () => {
      openDialog(
        "新增自有合同模板",
        `
        <label>模板名称<input name="name" required /></label>
        <label>成交类型<select name="deal_type"><option value="sale">买卖</option><option value="rent">租赁</option></select></label>
        <label class="full">模板内容<textarea name="content" rows="8" placeholder="支持自定义 {{占位符}}" required></textarea></label>
        `,
        async (fd) => {
          const result = await api("contract.template.save", {
            name: fd.get("name"),
            deal_type: fd.get("deal_type"),
            content: fd.get("content"),
          });
          toast(result.ok ? "合同模板已保存" : result.message, result.ok ? "ok" : "error");
          if (result.ok) render();
        }
      );
    });
  }
  const documentTemplateButton = main.querySelector("[data-doc-template]");
  if (documentTemplateButton) {
    documentTemplateButton.addEventListener("click", () => {
      openDialog(
        "新增交易资料模板",
        `
        <label>成交类型<select name="deal_type"><option value="sale">买卖</option><option value="rent">租赁</option></select></label>
        <label>分类代码<input name="category" placeholder="property_cert" required /></label>
        <label>显示名称<input name="label" placeholder="不动产权证" required /></label>
        <label>排序<input name="sort_order" type="number" value="0" /></label>
        <label><span><input name="required" type="checkbox" checked /> 必传</span></label>
        `,
        async (fd) => {
          const result = await api("deal.documents.template.save", {
            deal_type: fd.get("deal_type"),
            category: fd.get("category"),
            label: fd.get("label"),
            sort_order: Number(fd.get("sort_order")),
            required: fd.get("required") === "on",
          });
          toast(result.ok ? "资料模板已保存" : result.message, result.ok ? "ok" : "error");
          if (result.ok) render();
        }
      );
    });
  }
  const transferTemplateButton = main.querySelector("[data-transfer-template]");
  if (transferTemplateButton) {
    transferTemplateButton.addEventListener("click", () => {
      openDialog(
        "新增过户节点模板",
        `
        <label>成交类型<select name="deal_type"><option value="sale">买卖</option><option value="rent">租赁</option></select></label>
        <label>节点代码<input name="node_type" placeholder="contract / loan / tax" required /></label>
        <label>节点名称<input name="title" required /></label>
        <label>排序<input name="sort_order" type="number" value="0" /></label>
        <label>默认负责人<select name="default_assignee_role"><option value="">不指派</option><option value="agent">成交经纪人</option><option value="store_manager">店长</option><option value="finance">财务</option></select></label>
        `,
        async (fd) => {
          const result = await api("transfer.templates.save", {
            deal_type: fd.get("deal_type"),
            node_type: fd.get("node_type"),
            title: fd.get("title"),
            sort_order: Number(fd.get("sort_order")),
            default_assignee_role: fd.get("default_assignee_role"),
          });
          toast(result.ok ? "过户模板已保存" : result.message, result.ok ? "ok" : "error");
          if (result.ok) render();
        }
      );
    });
  }
}

async function renderMortgageCalc(main: HTMLElement) {
  main.innerHTML = `
    <div class="header"><h2>房贷计算器</h2></div>
    <form class="form-grid" data-calc-form>
      <label>贷款本金（元）<input name="principal" type="number" min="1" step="0.01" value="1000000" required /></label>
      <label>期限（月）<input name="months" type="number" min="1" max="600" value="360" required /></label>
      <label>LPR（%）<input name="lpr" type="number" min="0.01" max="30" step="0.01" value="3.45" required /></label>
      <label>基点 BP<input name="basis_points" type="number" min="-500" max="500" step="1" value="0" /></label>
      <label>还款方式<select name="method"><option value="equal_installment">等额本息</option><option value="equal_principal">等额本金</option></select></label>
      <div class="ops"><button class="btn" type="submit">计算</button></div>
    </form>
    <div class="meta" style="margin:8px 0 16px">本地测算工具：年利率 = LPR + BP/100；不连接银行接口，结果仅供参考。</div>
    <div class="stats" data-summary></div>
    <div class="list" data-schedule></div>
  `;
  const form = main.querySelector("[data-calc-form]") as HTMLFormElement;
  const summary = main.querySelector("[data-summary]")!;
  const schedule = main.querySelector("[data-schedule]")!;
  const drawResult = (result: any) => {
    const methodLabel = result.method === "equal_principal" ? "等额本金" : "等额本息";
    summary.innerHTML = `
      <div class="stat"><div class="n">${money(result.first_payment)}</div><div class="l">首月月供</div></div>
      <div class="stat"><div class="n">${money(result.last_payment)}</div><div class="l">末月月供</div></div>
      <div class="stat"><div class="n">${money(result.total_interest)}</div><div class="l">利息合计</div></div>
      <div class="stat"><div class="n">${money(result.total_payment)}</div><div class="l">还款总额</div></div>
      <div class="stat"><div class="n">${result.annual_rate}%</div><div class="l">执行年利率</div></div>
      <div class="stat"><div class="n">${methodLabel}</div><div class="l">方式 · ${result.months} 期</div></div>
    `;
    const rows = result.schedule as any[];
    const preview = rows.slice(0, 12);
    schedule.innerHTML = `
      <div class="row"><div><strong>还款计划预览（前 ${preview.length} 期 / 共 ${rows.length} 期）</strong></div></div>
      ${preview
        .map(
          (row) => `<div class="row"><div>
          <div><strong>第 ${row.period} 期</strong> · 月供 ¥${money(row.payment)}</div>
          <div class="meta">本金 ¥${money(row.principal)} · 利息 ¥${money(row.interest)} · 剩余 ¥${money(row.remaining)}</div>
        </div></div>`
        )
        .join("")}
    `;
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const result = await api("mortgageCalc.compute", {
      principal: Number(fd.get("principal")),
      months: Number(fd.get("months")),
      lpr: Number(fd.get("lpr")),
      basis_points: Number(fd.get("basis_points") || 0),
      method: fd.get("method"),
    });
    if (!result.ok) return toast(result.message, "error");
    drawResult(result.data);
  });
  form.requestSubmit();
}

async function renderMessages(main: HTMLElement) {
  const r = await api("message.list");
  main.innerHTML = `
    <div class="header"><h2>消息</h2>
      <div class="ops">
        <button class="btn ghost" data-subscriptions>订阅设置</button>
        <button class="btn ghost" data-read>全部已读</button>
      </div>
    </div>
    <div class="list" data-list></div>
  `;
  const list = main.querySelector("[data-list]")!;
  if (!r.ok) return (list.innerHTML = `<div class="error">${r.message}</div>`);
  const rows = r.data as any[];
  if (!rows.length) list.innerHTML = `<div class="empty">暂无消息</div>`;
  else {
    list.innerHTML = rows
      .map(
        (m) => `<div class="row"><div>
      <div>${m.is_read ? "" : `<span class="tag warn">未读</span>`}<strong>${escapeHtml(m.title)}</strong></div>
      <div class="meta">${escapeHtml(m.body)} · ${m.created_at}</div>
    </div></div>`
      )
      .join("");
  }
  main.querySelector("[data-read]")!.addEventListener("click", async () => {
    await api("message.read", {});
    render();
  });
  main.querySelector("[data-subscriptions]")!.addEventListener("click", async () => {
    const current = await api("message.subscriptions.get");
    if (!current.ok) return toast(current.message, "error");
    const channels = ((current.data as any).channels || []) as any[];
    openDialog(
      "消息订阅设置",
      channels
        .map(
          (channel) => `
        <label class="full">
          <span>
            <input name="ch_${channel.key}" type="checkbox" ${channel.enabled ? "checked" : ""} ${channel.locked ? "disabled" : ""} />
            ${escapeHtml(channel.label)}${channel.locked ? "（必开）" : ""}
          </span>
          <div class="meta">${escapeHtml(channel.description)}</div>
        </label>`
        )
        .join(""),
      async (fd) => {
        const payload: Record<string, boolean> = {};
        for (const channel of channels) {
          if (channel.locked) {
            payload[channel.key] = true;
            continue;
          }
          payload[channel.key] = fd.get(`ch_${channel.key}`) === "on";
        }
        const result = await api("message.subscriptions.save", { channels: payload });
        toast(result.ok ? "订阅设置已保存" : result.message, result.ok ? "ok" : "error");
      }
    );
  });
}

async function renderOrg(main: HTMLElement) {
  const stores = await api("org.stores.list");
  const users = await api("org.users.list");
  main.innerHTML = `
    <div class="header"><h2>组织</h2>
      <div class="ops">
        <button class="btn ghost" data-store>新建门店</button>
        <button class="btn" data-user>新建员工</button>
      </div>
    </div>
    <h3>门店</h3>
    <div class="list" data-stores></div>
    <h3>员工</h3>
    <div class="list" data-users></div>
  `;
  main.querySelector("[data-stores]")!.innerHTML = ((stores.data as any[]) || [])
    .map(
      (s) =>
        `<div class="row"><div><strong>${s.name}</strong><div class="meta">${s.address || ""} · ${s.status}</div></div></div>`
    )
    .join("") || `<div class="empty">无门店</div>`;
  main.querySelector("[data-users]")!.innerHTML = ((users.data as any[]) || [])
    .map(
      (u) =>
        `<div class="row"><div><strong>${u.display_name}</strong> (${u.account})
        <div class="meta">${roleLabel(u.role)} · 门店 ${u.store_id} · ${u.status}</div></div></div>`
    )
    .join("") || `<div class="empty">无员工</div>`;
  main.querySelector("[data-store]")!.addEventListener("click", () => {
    openDialog(
      "新建门店",
      `<label class="full">名称<input name="name" required /></label><label class="full">地址<input name="address" /></label>`,
      async (fd) => {
        const r = await api("org.stores.upsert", {
          name: fd.get("name"),
          address: fd.get("address"),
        });
        toast(r.ok ? "门店已创建" : r.message, r.ok ? "ok" : "error");
      }
    );
  });
  main.querySelector("[data-user]")!.addEventListener("click", () => {
    const opts = ((stores.data as any[]) || [])
      .map((s) => `<option value="${s.id}">${s.name}</option>`)
      .join("");
    openDialog(
      "新建员工",
      `
      <label>账号<input name="account" required /></label>
      <label>姓名<input name="display_name" required /></label>
      <label>角色<select name="role"><option value="agent">经纪人</option><option value="store_manager">店长</option><option value="finance">财务</option><option value="admin">管理员</option></select></label>
      <label>门店<select name="store_id">${opts}</select></label>
      <label class="full">初始密码<input name="password" value="123456" required /></label>
      `,
      async (fd) => {
        const r = await api("org.users.upsert", {
          account: fd.get("account"),
          display_name: fd.get("display_name"),
          role: fd.get("role"),
          store_id: fd.get("store_id"),
          password: fd.get("password"),
        });
        toast(r.ok ? "员工已创建" : r.message, r.ok ? "ok" : "error");
      }
    );
  });
}

async function renderAudit(main: HTMLElement) {
  main.innerHTML = `
    <div class="header"><h2>审计日志</h2><button class="btn ghost" data-export>导出 CSV</button></div>
    <div class="filters">
      <input data-action placeholder="动作，如 deal" />
      <input data-target placeholder="对象类型，如 customer" />
      <input data-start type="date" />
      <input data-end type="date" />
    </div>
    <div class="list" data-list></div>
  `;
  const list = main.querySelector("[data-list]")!;
  let currentRows: any[] = [];
  const draw = async () => {
    const action = (main.querySelector("[data-action]") as HTMLInputElement).value;
    const targetType = (main.querySelector("[data-target]") as HTMLInputElement).value;
    const start = (main.querySelector("[data-start]") as HTMLInputElement).value;
    const end = (main.querySelector("[data-end]") as HTMLInputElement).value;
    const result = await api("audit.list", {
      action: action || undefined,
      target_type: targetType || undefined,
      start_at: start ? `${start}T00:00:00.000Z` : undefined,
      end_at: end ? `${end}T23:59:59.999Z` : undefined,
      limit: 500,
    });
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    currentRows = result.data as any[];
    list.innerHTML =
      currentRows
        .map(
          (a) => `<div class="row"><div>
          <div><strong>${a.action}</strong></div>
          <div class="meta">${a.user_id || "-"} · ${a.target_type || ""} ${a.target_id || ""} · ${a.created_at}</div>
        </div></div>`
        )
        .join("") || `<div class="empty">暂无日志</div>`;
  };
  main.querySelectorAll(".filters input").forEach((input) =>
    input.addEventListener("change", draw)
  );
  main.querySelector("[data-action]")!.addEventListener("input", draw);
  main.querySelector("[data-export]")!.addEventListener("click", () => {
    const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["动作", "用户", "对象类型", "对象ID", "时间"].map(cell).join(","),
      ...currentRows.map((row) =>
        [row.action, row.user_id, row.target_type, row.target_id, row.created_at]
          .map(cell)
          .join(",")
      ),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `审计日志-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  });
  await draw();
}

async function boot() {
  await initApiBase();
  if (state.token) {
    const me = await api("auth.me");
    if (me.ok) state.user = me.data;
    else {
      state.token = "";
      localStorage.removeItem("weilaijia.token");
    }
  }
  await render();
}

boot();
