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

function el(html: string) {
  const box = document.createElement("div");
  box.innerHTML = html.trim();
  return box.firstElementChild as HTMLElement;
}

function canSee(tab: string) {
  const role = state.user?.role;
  if (!role) return false;
  if (tab === "org" || tab === "audit") return role === "admin" || (tab === "audit" && role === "store_manager");
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
  if (role === "finance" && tab.startsWith("suite-")) return tab === "suite-finance";
  if (tab === "suite-finance") return ["admin", "finance", "store_manager"].includes(role);
  if (["suite-hr", "suite-performance", "suite-marketing", "suite-care"].includes(tab))
    return ["admin", "store_manager"].includes(role);
  return true;
}

async function render() {
  const root = document.getElementById("app")!;
  if (!state.token || !state.user) {
    root.innerHTML = "";
    root.appendChild(renderLogin());
    return;
  }
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
    ["suite-property", "房源扩展"],
    ["suite-deal", "交易扩展"],
    ["suite-newhome", "新房分销"],
    ["suite-finance", "财务管理"],
    ["suite-office", "办公协同"],
    ["suite-hr", "人事管理"],
    ["suite-rental", "租赁托管"],
    ["suite-care", "客户关怀"],
    ["suite-marketing", "营销线索"],
    ["suite-performance", "积分分红"],
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
  if (state.tab.startsWith("suite-")) {
    const moduleMap: Record<string, string> = {
      "suite-property": "property_ext",
      "suite-deal": "deal_ext",
      "suite-newhome": "newhome",
      "suite-finance": "finance",
      "suite-office": "office",
      "suite-hr": "hr",
      "suite-rental": "rental",
      "suite-care": "customer_care",
      "suite-marketing": "marketing",
      "suite-performance": "performance",
    };
    return renderSuite(main, moduleMap[state.tab]);
  }
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
    list.innerHTML = rows
      .map(
        (h) => `
      <div class="row">
        <div>
          <div><span class="tag">${h.deal_type === "sale" ? "售" : "租"}</span>
          <span class="tag ${h.status === "available" ? "ok" : ""}">${houseStatusLabel(h.status, h.deal_type)}</span>
          ${h.is_private ? `<span class="tag warn">保密盘</span>` : ""}
          <strong>${h.title}</strong></div>
          <div class="meta">${h.community} · ${h.price}${h.price_unit === "wan" ? " 万" : " 元/月"} · 业主 ${h.owner_name} ${h.owner_phone}${h.owner_phone_masked ? "（已脱敏）" : ""}</div>
        </div>
        <div class="ops">
          ${h.status === "draft" ? `<button class="btn ghost" data-status="${h.id}" data-to="available">上架</button>` : ""}
          ${h.status === "available" ? `<button class="btn ghost" data-status="${h.id}" data-to="suspended">暂缓</button>` : ""}
          ${["available", "suspended", "draft"].includes(h.status) ? `<button class="btn danger" data-withdraw="${h.id}">撤盘</button>` : ""}
        </div>
      </div>`
      )
      .join("");
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
        <strong>${c.name}</strong> ${c.phone}${c.phone_masked ? "（已脱敏）" : ""}</div>
        <div class="meta">${c.need || "无需求备注"} · 状态 ${c.status}</div>
      </div>
      <div class="ops">
        <button class="btn ghost" data-match="${c.id}">匹配房源</button>
        <button class="btn ghost" data-contacts="${c.id}">联系人</button>
        ${["admin", "store_manager"].includes(state.user.role) ? `<button class="btn ghost" data-merge="${c.id}">合并</button>` : ""}
        ${c.visibility === "private" ? `<button class="btn ghost" data-public="${c.id}">转公客</button>` : `<button class="btn" data-claim="${c.id}">认领</button>`}
      </div></div>`
      )
      .join("");
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
    list.innerHTML = rows
      .map(
        (d) => `<div class="row"><div>
        <div><span class="tag ${d.status === "approved" ? "ok" : d.status === "rejected" ? "danger" : "warn"}">${d.status}</span>
        <strong>${d.id}</strong> 佣金 ¥${money(d.commission_total)} · 未收 ¥${money(d.unpaid_amount)}</div>
        <div class="meta">房 ${d.house_id} · 客 ${d.customer_id} · 成交价 ${d.contract_price}${d.reject_reason ? ` · 驳回：${d.reject_reason}` : ""}</div>
      </div>
      <div class="ops">
        ${desktopShell ? `<button class="btn ghost" data-files="${d.id}">附件</button>` : ""}
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
        const paths = (await desktopShell.chooseFiles()) as string[];
        for (const localPath of paths) {
          const name = localPath.split(/[\\/]/).pop() || "附件";
          const added = await api("attachment.add", {
            parent_type: "deal",
            parent_id: dealId,
            category: "contract",
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
  main.querySelector("[data-status]")!.addEventListener("change", draw);
  await draw();
}

async function renderTransfer(main: HTMLElement) {
  const deals = await api("deal.list", { status: "approved" });
  const canCreate = ["admin", "store_manager"].includes(state.user.role);
  main.innerHTML = `
    <div class="header"><h2>过户节点</h2>${canCreate ? `<button class="btn" data-new>新增节点</button>` : ""}</div>
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
  main.innerHTML = `
    <div class="header"><h2>收款</h2>
      ${["admin", "finance"].includes(state.user.role) ? `<button class="btn" data-new>登记收款</button>` : ""}
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
        <div><strong>¥${money(p.amount)}</strong> · ${p.method} · ${p.payer_side}</div>
        <div class="meta">成交单 ${p.deal_id} · ${p.paid_at}</div>
      </div></div>`
      )
      .join("");
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
        "登记收款",
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
          else toast(res.ok ? "收款已登记" : res.message, res.ok ? "ok" : "error");
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
  main.innerHTML = `
    <div class="header"><h2>经营报表</h2><button class="btn ghost" data-export>导出成交 CSV</button></div>
    <div class="filters"><input data-month type="month" value="${defaultMonth}" /></div>
    <div data-report></div>
  `;
  const draw = async () => {
    const month = (main.querySelector("[data-month]") as HTMLInputElement).value;
    const result = await api("report.business", { month });
    const container = main.querySelector("[data-report]")!;
    if (!result.ok) return (container.innerHTML = `<div class="error">${result.message}</div>`);
    const report = result.data as any;
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
    `;
  };
  main.querySelector("[data-month]")!.addEventListener("change", draw);
  main.querySelector("[data-export]")!.addEventListener("click", async () => {
    const month = (main.querySelector("[data-month]") as HTMLInputElement).value;
    const result = await api("report.dealsCsv", { month });
    if (!result.ok) return toast(result.message, "error");
    const file = result.data as any;
    const blob = new Blob([file.content], { type: file.mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`已导出 ${file.rows} 条成交`);
  });
  await draw();
}

const suiteMeta: Record<
  string,
  { title: string; types: Array<[string, string]> }
> = {
  property_ext: {
    title: "房源扩展",
    types: [
      ["entrustment", "业主委托"],
      ["listing_lock", "锁定盘"],
      ["cooperation", "合作盘"],
      ["media", "视频/全景"],
      ["auction", "拍卖模式"],
      ["exclusive_agency", "包销/独家代理"],
    ],
  },
  deal_ext: {
    title: "交易扩展",
    types: [
      ["mortgage", "贷款按揭"],
      ["deal_complaint", "成交投诉"],
      ["rename", "成交更名"],
      ["document_checklist", "交易资料清单"],
    ],
  },
  newhome: {
    title: "新房分销",
    types: [
      ["project", "新房项目"],
      ["registration", "客户报备"],
      ["arrival", "到场确认"],
      ["distribution_company", "分销公司"],
      ["sales_report", "销售报告"],
    ],
  },
  finance: {
    title: "财务管理",
    types: [
      ["income", "收入"],
      ["expense", "支出"],
      ["reimbursement", "费用报销"],
      ["asset", "资产"],
      ["voucher", "会计凭证"],
      ["payroll", "薪酬发放"],
    ],
  },
  office: {
    title: "办公协同",
    types: [
      ["announcement", "公告"],
      ["knowledge", "知识文章"],
      ["exam", "考试"],
      ["event", "会议活动"],
      ["workflow", "流程会签"],
      ["ticket", "票据流转"],
      ["work_summary", "工作总结"],
      ["circle_post", "同事圈"],
      ["call_record", "来电记录"],
    ],
  },
  hr: {
    title: "人事管理",
    types: [
      ["job_grade", "岗位职级"],
      ["transfer", "员工调动"],
      ["offboarding", "离职交接"],
      ["attendance", "考勤"],
      ["leave", "请假"],
      ["job", "招聘岗位"],
      ["applicant", "应聘记录"],
      ["employee_contract", "人事合同"],
      ["salary", "薪酬条"],
    ],
  },
  rental: {
    title: "租赁托管",
    types: [
      ["managed_property", "托管物业"],
      ["lease", "租约"],
      ["bill", "租金账单"],
      ["maintenance", "维修工单"],
      ["cleaning", "保洁工单"],
    ],
  },
  customer_care: {
    title: "客户关怀",
    types: [
      ["complaint", "投诉"],
      ["lawsuit", "诉讼"],
      ["survey", "满意度问卷"],
      ["callback", "客户回访"],
    ],
  },
  marketing: {
    title: "营销线索",
    types: [
      ["website_page", "官网内容"],
      ["online_entrustment", "在线委托"],
      ["lead", "商机线索"],
      ["campaign", "营销活动"],
    ],
  },
  performance: {
    title: "积分分红",
    types: [
      ["points", "积分"],
      ["bonus", "管理奖"],
      ["dividend", "利润分红"],
      ["target", "业绩目标"],
    ],
  },
};

async function renderSuite(main: HTMLElement, module: string) {
  const meta = suiteMeta[module];
  if (!meta) {
    main.innerHTML = `<div class="error">模块不存在</div>`;
    return;
  }
  main.innerHTML = `
    <div class="header"><h2>${meta.title}</h2><button class="btn" data-new>新建记录</button></div>
    <div class="filters">
      <select data-type><option value="">全部类型</option>${meta.types
        .map(([value, label]) => `<option value="${value}">${label}</option>`)
        .join("")}</select>
      <select data-status><option value="">全部状态</option><option value="draft">草稿</option><option value="pending">待审批</option><option value="approved">已审批</option><option value="active">生效</option><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="rejected">已驳回</option></select>
    </div>
    <div class="list" data-list></div>
  `;
  const typeLabel = Object.fromEntries(meta.types);
  const draw = async () => {
    const recordType = (main.querySelector("[data-type]") as HTMLSelectElement).value;
    const status = (main.querySelector("[data-status]") as HTMLSelectElement).value;
    const result = await api("suite.list", {
      module,
      ...(recordType ? { record_type: recordType } : {}),
      ...(status ? { status } : {}),
    });
    const list = main.querySelector("[data-list]")!;
    if (!result.ok) return (list.innerHTML = `<div class="error">${result.message}</div>`);
    const rows = result.data as any[];
    list.innerHTML =
      rows
        .map(
          (record) => `<div class="row"><div>
            <div><span class="tag ${["approved", "active", "completed"].includes(record.status) ? "ok" : record.status === "rejected" ? "danger" : "warn"}">${record.status}</span><span class="tag">${typeLabel[record.record_type] || record.record_type}</span><strong>${record.title}</strong>${record.amount != null ? ` · ¥${money(record.amount)}` : ""}</div>
            <div class="meta">${record.due_at ? `截止 ${record.due_at} · ` : ""}${record.data?.description || record.data?.note || "无补充说明"}${record.reject_reason ? ` · 驳回：${record.reject_reason}` : ""}</div>
          </div><div class="ops">
            ${["draft", "rejected"].includes(record.status) ? `<button class="btn" data-status-id="${record.id}" data-to="pending">提交</button>` : ""}
            ${record.status === "pending" && (["admin", "store_manager"].includes(state.user.role) || (state.user.role === "finance" && module === "finance")) ? `<button class="btn" data-status-id="${record.id}" data-to="approved">审批</button><button class="btn danger" data-reject-record="${record.id}">驳回</button>` : ""}
            ${["approved", "active"].includes(record.status) ? `<button class="btn ghost" data-status-id="${record.id}" data-to="in_progress">开始</button>` : ""}
            ${["approved", "active", "in_progress"].includes(record.status) ? `<button class="btn" data-status-id="${record.id}" data-to="completed">完成</button>` : ""}
          </div></div>`
        )
        .join("") || `<div class="empty">暂无${meta.title}记录</div>`;
    list.querySelectorAll("[data-status-id]").forEach((button) =>
      button.addEventListener("click", async () => {
        const element = button as HTMLElement;
        const result = await api("suite.status", {
          id: element.dataset.statusId,
          status: element.dataset.to,
        });
        toast(result.ok ? "状态已更新" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
    list.querySelectorAll("[data-reject-record]").forEach((button) =>
      button.addEventListener("click", async () => {
        const reason = prompt("驳回原因");
        if (!reason) return;
        const result = await api("suite.status", {
          id: (button as HTMLElement).dataset.rejectRecord,
          status: "rejected",
          reason,
        });
        toast(result.ok ? "已驳回" : result.message, result.ok ? "ok" : "error");
        if (result.ok) draw();
      })
    );
  };
  main.querySelector("[data-new]")!.addEventListener("click", () => {
    openDialog(
      `新建${meta.title}记录`,
      `
      <label>类型<select name="record_type">${meta.types
        .map(([value, label]) => `<option value="${value}">${label}</option>`)
        .join("")}</select></label>
      <label>标题<input name="title" required /></label>
      <label>金额<input name="amount" type="number" step="0.01" /></label>
      <label>截止时间<input name="due_at" type="datetime-local" /></label>
      <label class="full">说明<textarea name="description" rows="4"></textarea></label>
      `,
      async (fd) => {
        const dueAt = String(fd.get("due_at") || "");
        const result = await api("suite.create", {
          module,
          record_type: fd.get("record_type"),
          title: fd.get("title"),
          amount: fd.get("amount") ? Number(fd.get("amount")) : null,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
          data: { description: fd.get("description") },
        });
        toast(result.ok ? "记录已创建" : result.message, result.ok ? "ok" : "error");
      }
    );
  });
  main.querySelector("[data-type]")!.addEventListener("change", draw);
  main.querySelector("[data-status]")!.addEventListener("change", draw);
  await draw();
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
  main.innerHTML = `
    <div class="header"><h2>系统中心</h2><div class="ops">
      ${canManageSystem ? `<button class="btn ghost" data-blacklist>添加黑名单</button>` : ""}
      <button class="btn ghost" data-password>修改密码</button>
      ${desktopShell ? `<button class="btn ghost" data-screenshot>截图</button><button class="btn ghost" data-fullscreen>全屏</button><button class="btn ghost" data-clear-cache>清缓存</button>` : ""}
      ${state.user.role === "admin" ? `<button class="btn ghost" data-permission>功能权限</button><button class="btn ghost" data-backup>立即备份</button>` : ""}
      ${state.user.role === "admin" ? `<button class="btn" data-integration>配置适配器</button>` : ""}
    </div></div>
    ${canManageSystem ? `<h3>业务黑名单</h3><div class="list" data-blacklist-list></div>` : ""}
    ${state.user.role === "admin" ? `<h3>数据库备份</h3><div class="list" data-backups></div>` : ""}
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
}

async function renderMessages(main: HTMLElement) {
  const r = await api("message.list");
  main.innerHTML = `
    <div class="header"><h2>消息</h2><button class="btn ghost" data-read>全部已读</button></div>
    <div class="list" data-list></div>
  `;
  const list = main.querySelector("[data-list]")!;
  if (!r.ok) return (list.innerHTML = `<div class="error">${r.message}</div>`);
  const rows = r.data as any[];
  if (!rows.length) return (list.innerHTML = `<div class="empty">暂无消息</div>`);
  list.innerHTML = rows
    .map(
      (m) => `<div class="row"><div>
      <div>${m.is_read ? "" : `<span class="tag warn">未读</span>`}<strong>${m.title}</strong></div>
      <div class="meta">${m.body} · ${m.created_at}</div>
    </div></div>`
    )
    .join("");
  main.querySelector("[data-read]")!.addEventListener("click", async () => {
    await api("message.read", {});
    render();
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
