# MVP 需求规格书

| 项 | 内容 |
|----|------|
| 产品 | 自研房产中介业务系统（工作名：未来家本地 / 盘客成交 MVP） |
| 版本 | MVP-1.0 |
| 日期 | 2026-08-06 |
| 目标 | 单店（可扩展多店）经纪人完成：**录盘 → 录客 → 跟进 → 带看 → 成交 → 收款** |
| 配套 | [`功能说明书.md`](./功能说明书.md) · [`功能差距对照表.md`](./功能差距对照表.md) · [`自研开发参考分析.md`](./自研开发参考分析.md) · [`AI全功能开发任务板.md`](./AI全功能开发任务板.md) |
| 定位 | **自研规格**，非厂商产品复刻；UI/接口/数据模型独立设计 |

---

## 1. 范围与成功标准

### 1.1 范围内（In Scope）

| 域 | 代号 | 说明 |
|----|------|------|
| 组织与账号 | ORG | 公司 → 门店 → 员工；登录；4 角色权限 |
| 盘客·房源 | HOUSE | 二手售 + 租赁；状态；接盘人；跟进 |
| 盘客·客源 | CUS | 买/租意图；公私客；等级；跟进 |
| 盘客·跟进 | FLW | 房/客通用跟进流水 |
| 带看 | VIEW | 客户 + 房源 + 时间 + 结果 |
| 成交收款 | DEAL | 意向金（可选）→ 成交单 → 收款流水 → 简易提成 |

### 1.2 明确不做（Out of Scope · MVP）

- 全国楼盘字典、地图找房、全景/户型图角色人体系  
- 钥匙全流程、实勘验真、带看视频、隐号拨打  
- 新房报备/分销/小程序  
- 完整财务总账、凭证、报销、薪酬发薪  
- 电子合同/电子签、过户专模块  
- 人事考勤招聘、办公流程、网站营销  
- 厂商许可号 / 设备指纹云校验 / 主机分机  

### 1.3 成功标准（验收总目标）

用演示数据走通一条主路径，全部为真：

1. 管理员创建门店与 2 名经纪人账号  
2. 经纪人 A 录入 1 套房源、1 个私客  
3. A 写 2 条跟进，并创建 1 次带看（关联该房该客）  
4. 带看结果为「有意向」后，创建成交单（草稿→提交→店长审批→已成交）  
5. 登记至少 1 笔佣金收款；系统按规则算出经纪人提成金额  
6. 经纪人 B **看不到** A 的私客；店长能看到本店全部房客  

---

## 2. 角色与权限

### 2.1 角色定义

| 角色代码 | 名称 | 典型职责 |
|----------|------|----------|
| `admin` | 管理员 | 组织、员工、全公司数据、系统参数 |
| `store_manager` | 店长 | 本店房客/带看/成交审批、看本店业绩 |
| `agent` | 经纪人 | 本人盘客、跟进、带看、提交成交 |
| `finance` | 财务 | 成交单收款确认、查看收款与提成（不改盘客） |

> 现有本地 demo 的 `staff` 映射为 MVP 的 `agent`。

### 2.2 数据范围

| 范围 | 含义 |
|------|------|
| 本人 | `owner_user_id` / `agent_id` = 当前用户 |
| 本店 | `store_id` = 当前用户所属门店 |
| 全公司 | 当前公司下全部门店 |

### 2.3 权限矩阵（MVP）

| 能力 | admin | store_manager | agent | finance |
|------|:-----:|:-------------:|:-----:|:-------:|
| 管理公司/门店/员工 | ✅ | ❌ | ❌ | ❌ |
| 看本店房源列表 | ✅全公司 | ✅本店 | ✅本店公开盘 + 本人盘 | ❌ |
| 新建/编辑房源 | ✅ | ✅本店 | ✅本人接盘 | ❌ |
| 改接盘人 | ✅ | ✅本店 | ❌ | ❌ |
| 看私客 | ✅全公司 | ✅本店 | ✅本人 | ❌ |
| 看公客 | ✅ | ✅本店 | ✅本店 | ❌ |
| 私客转公客 | ✅ | ✅本店 | ✅本人 | ❌ |
| 写跟进 | ✅ | ✅本店可见对象 | ✅本人相关 | ❌ |
| 创建带看 | ✅ | ✅ | ✅ | ❌ |
| 提交成交单 | ✅ | ✅ | ✅本人相关 | ❌ |
| 审批成交单 | ✅ | ✅本店 | ❌ | ❌ |
| 登记/确认收款 | ✅ | △仅查看 | ❌ | ✅ |
| 看提成报表 | ✅ | ✅本店 | ✅本人 | ✅全公司 |

**保密盘（MVP 简化）**：房源标记 `is_private=true` 时，仅接盘人、店长、管理员可见；其他经纪人列表中不可见。

---

## 3. 组织（ORG）

### 3.1 实体与字段

#### 公司 `companies`

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | 主键 |
| name | string | ✅ | 公司名称 |
| status | enum | ✅ | `active` / `disabled` |
| created_at | datetime | ✅ | |

#### 门店 `stores`

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | |
| company_id | string | ✅ | |
| name | string | ✅ | |
| address | string | | |
| status | enum | ✅ | `active` / `disabled` |
| created_at | datetime | ✅ | |

#### 员工 `users`

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | |
| company_id | string | ✅ | |
| store_id | string | ✅ | MVP 一人一店 |
| account | string | ✅ | 登录名，公司内唯一 |
| display_name | string | ✅ | |
| password_hash | string | ✅ | 禁止明文存储（demo 可暂缓，上线前必须改） |
| role | enum | ✅ | 见 2.1 |
| phone | string | | |
| status | enum | ✅ | `active` / `disabled` |
| created_at | datetime | ✅ | |

### 3.2 功能需求

| ID | 需求 | 优先级 |
|----|------|:------:|
| ORG-01 | 管理员可维护门店（增/改/启停） | P0 |
| ORG-02 | 管理员可创建员工、设角色、重置密码、启停 | P0 |
| ORG-03 | 账号密码登录；会话保持；退出 | P0 |
| ORG-04 | 禁用账号不可登录 | P0 |
| ORG-05 | 列表展示：门店人数、角色分布（简单统计即可） | P1 |

### 3.3 业务规则

- MVP **不建「区域」层**；多店靠 `stores` 平铺。  
- 员工调店：仅 admin；调店后历史单据保留原 `store_id` 快照字段（见成交）。  
- 删除员工：MVP **只允许停用**，不做物理删除。

---

## 4. 盘客 · 房源（HOUSE）

### 4.1 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | 如 H + 流水 |
| company_id | string | ✅ | |
| store_id | string | ✅ | 归属门店 |
| title | string | ✅ | 列表标题 |
| deal_type | enum | ✅ | `sale` 二手售 / `rent` 租赁 |
| status | enum | ✅ | 见状态机 |
| community | string | ✅ | 小区名（手填，不做全国字典） |
| address | string | | 详细地址 |
| district | string | | 片区 |
| price | number | ✅ | 售：万元；租：元/月 |
| price_unit | enum | ✅ | `wan` / `yuan_month` |
| area_size | number | | 建筑面积 ㎡ |
| rooms | string | | 如 `2室1厅` |
| floor | string | | 如 `8/18` |
| owner_name | string | ✅ | 业主姓名 |
| owner_phone | string | ✅ | 业主电话（权限控制可见） |
| listing_user_id | string | ✅ | 登记人 |
| agent_id | string | ✅ | 接盘人（默认=登记人） |
| is_private | bool | ✅ | 保密盘，默认 false |
| source | string | | 来源：上门/网络/老客户… |
| remark | string | | |
| created_at / updated_at | datetime | ✅ | |

### 4.2 状态机

```text
draft（草稿）
  → available（在售/待租）  【提交上架】
  → suspended（暂缓）
  → deal_pending（成交中）  【关联未结案成交单时系统可置】
  → closed（已成交）        【成交单变为已成交】
  → withdrawn（已撤盘）

任意非 closed → withdrawn（撤盘，需填写原因）
suspended ↔ available
closed / withdrawn 为终态（MVP 不可逆；纠错走管理员「反审」见 DEAL）
```

| 状态 | 售盘展示名 | 租盘展示名 |
|------|------------|------------|
| draft | 草稿 | 草稿 |
| available | 在售 | 待租 |
| suspended | 暂缓 | 暂缓 |
| deal_pending | 成交中 | 成交中 |
| closed | 已售 | 已租 |
| withdrawn | 已撤盘 | 已撤盘 |

### 4.3 功能需求

| ID | 需求 | 优先级 |
|----|------|:------:|
| HOUSE-01 | 列表：筛选 deal_type / status / 小区 / 接盘人 / 价格区间；分页 | P0 |
| HOUSE-02 | 新建、编辑、查看详情 | P0 |
| HOUSE-03 | 改状态（上架/暂缓/撤盘）并记操作日志 | P0 |
| HOUSE-04 | 店长/管理员可变更接盘人 | P0 |
| HOUSE-05 | 业主电话：经纪人仅本人接盘可见；店长/管理员可见本店/全公司 | P0 |
| HOUSE-06 | 房源详情页展示跟进时间线 + 关联带看 + 关联成交 | P0 |
| HOUSE-07 | 简易查重提示：同小区+相近面积+同业主电话（软提示，不阻断） | P1 |

---

## 5. 盘客 · 客源（CUS）

### 5.1 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | |
| company_id / store_id | string | ✅ | |
| name | string | ✅ | |
| phone | string | ✅ | 公司内查重键 |
| intent | enum | ✅ | `buy` / `rent` |
| budget_min / budget_max | number | | 预算 |
| budget_note | string | | 自由文本预算（兼容现有） |
| need | string | | 需求描述 |
| level | enum | ✅ | `A` / `B` / `C`（手工） |
| visibility | enum | ✅ | `private` 私客 / `public` 公客 |
| status | enum | ✅ | 见状态机 |
| agent_id | string | ✅ | 维护人 |
| source | string | | |
| remark | string | | |
| created_at / updated_at | datetime | ✅ | |

### 5.2 状态机

```text
new（待联系）
  → following（跟进中）
  → viewing（带看中）     【存在未完结带看时可标】
  → deal_pending（成交中）
  → closed（已成交）
  → invalid（无效）
  → public_pool（已转公客池）  【visibility 同步为 public，agent 可清空或保留原维护人】
```

### 5.3 功能需求

| ID | 需求 | 优先级 |
|----|------|:------:|
| CUS-01 | 列表筛选：意图/等级/公私/状态/维护人 | P0 |
| CUS-02 | 新建、编辑、详情 | P0 |
| CUS-03 | 手机号公司内查重：重复则提示并链到已有客（不强制合并） | P0 |
| CUS-04 | 私客转公客（写原因）；公客认领为本店私客（仅无主公客或本店公客） | P0 |
| CUS-05 | 详情：跟进 / 带看 / 成交时间线 | P0 |

### 5.4 公私客规则（写死，不做参数后台）

1. 新建默认 `private`，`agent_id` = 当前用户。  
2. 经纪人只能看：**本人私客 + 本店公客**。  
3. 转公客后，本店经纪人可见可跟进；认领后变私客并改 `agent_id`。  
4. MVP **不做**自动掉公（N 天未跟进自动转公）；可在 P2 加。

---

## 6. 跟进（FLW）

### 6.1 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | |
| company_id / store_id | string | ✅ | |
| target_type | enum | ✅ | `house` / `customer` |
| target_id | string | ✅ | |
| content | string | ✅ | 跟进内容，≥5 字 |
| method | enum | | `call` / `wechat` / `visit` / `other` |
| next_follow_at | datetime | | 下次跟进提醒 |
| created_by | string | ✅ | |
| created_at | datetime | ✅ | |

### 6.2 功能需求

| ID | 需求 | 优先级 |
|----|------|:------:|
| FLW-01 | 在房源/客源详情新增跟进 | P0 |
| FLW-02 | 跟进后：客源 `new`→`following`；更新目标 `updated_at` | P0 |
| FLW-03 | 我的待跟进：`next_follow_at ≤ 今天` 的列表 | P1 |
| FLW-04 | 禁止删除跟进；仅 admin 可「作废」标记（可选） | P1 |

---

## 7. 带看（VIEW）

### 7.1 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | |
| company_id / store_id | string | ✅ | |
| customer_id | string | ✅ | |
| house_id | string | ✅ | MVP 一次带看关联 **1** 套房（多套房拆多单） |
| view_at | datetime | ✅ | 带看时间 |
| agent_id | string | ✅ | 主看人 |
| accompany_ids | string[] | | 陪看人（可空） |
| feedback | enum | ✅ | 见结果枚举 |
| content | string | | 客户反馈备注 |
| status | enum | ✅ | `planned` / `done` / `cancelled` |
| created_by / created_at | | ✅ | |
| updated_at | datetime | ✅ | |

### 7.2 结果枚举 `feedback`

| 值 | 含义 |
|----|------|
| pending | 未反馈（预约中） |
| interested | 有意向 |
| considering | 再看看 |
| rejected | 不考虑 |
| deal | 当场意向成交（仍须走成交单） |

### 7.3 状态机

```text
planned → done（填写 feedback ≠ pending）
planned → cancelled
done / cancelled 终态
```

### 7.4 功能需求

| ID | 需求 | 优先级 |
|----|------|:------:|
| VIEW-01 | 创建带看：选客、选房、时间、主看人 | P0 |
| VIEW-02 | 完成带看：填结果与备注 | P0 |
| VIEW-03 | 列表筛选：时间范围/主看人/结果/状态 | P0 |
| VIEW-04 | 完成后：客源状态可升为 `viewing`；房源/客源详情可见该单 | P0 |
| VIEW-05 | 从「有意向」带看一键「发起成交」预填客与房 | P1 |

### 7.5 业务规则

- 取消须填原因（记在 content 或独立 cancel_reason）。  
- 经纪人仅可改本人主看的 `planned` 单；店长可改本店。  
- MVP 不做带看视频、多联系人复杂模型。

---

## 8. 成交与收款（DEAL）

### 8.1 意向金（可选子单）`earnest_moneys`

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | |
| company_id / store_id | string | ✅ | |
| customer_id / house_id | string | ✅ | |
| amount | number | ✅ | 元 |
| paid_at | datetime | ✅ | |
| method | enum | ✅ | `cash` / `transfer` / `other` |
| status | enum | ✅ | `held` 在管 / `refunded` 已退 / `applied` 已冲抵佣金 |
| remark | string | | |
| created_by / created_at | | ✅ | |

> 意向金 **不强制**：可直接建成交单。若存在 `held` 意向金，成交收款时可勾选冲抵。

### 8.2 成交单 `deals`

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | |
| company_id | string | ✅ | |
| store_id | string | ✅ | 业绩归属店（创建时快照） |
| deal_type | enum | ✅ | `sale` / `rent` |
| house_id / customer_id | string | ✅ | |
| view_id | string | | 来源带看（可空） |
| contract_price | number | ✅ | 成交价：售=万元，租=元/月 |
| commission_total | number | ✅ | 应收佣金合计（元） |
| commission_owner | number | | 业主佣（元），可 0 |
| commission_customer | number | | 客户佣（元），可 0 |
| deal_date | date | ✅ | 签约/成交日 |
| status | enum | ✅ | 见状态机 |
| agent_ids | string[] | ✅ | 分成经纪人，至少 1 人 |
| split_ratios | object | ✅ | `{ userId: percent }` 合计 100 |
| remark | string | | |
| submitted_by / submitted_at | | | |
| approved_by / approved_at | | | |
| reject_reason | string | | |
| created_at / updated_at | | ✅ | |

约束：`commission_owner + commission_customer = commission_total`（允许一侧为 0）。

### 8.3 成交单状态机

```text
draft（草稿）
  → pending_approval（已提交）
  → approved（已审批/已成交）   【店长或 admin】
  → rejected（已驳回） → 可改回 draft 再提
  → void（作废）               【仅 admin；已收款则须先处理流水】

approved 为业务终态（正常）
```

审批通过时系统副作用：

1. 房源 → `closed`  
2. 客源 → `closed`  
3. 生成提成应计记录（见 8.5）

### 8.4 收款流水 `payments`

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | string | ✅ | |
| company_id / store_id | string | ✅ | |
| deal_id | string | ✅ | |
| amount | number | ✅ | 元，>0 |
| pay_type | enum | ✅ | `commission` 佣金 / `earnest_apply` 意向金冲抵 |
| method | enum | ✅ | `cash` / `transfer` / `other` |
| paid_at | datetime | ✅ | |
| payer_side | enum | ✅ | `owner` / `customer` / `other` |
| status | enum | ✅ | `confirmed` / `void` |
| remark | string | | |
| created_by / created_at | | ✅ | |

| ID | 需求 | 优先级 |
|----|------|:------:|
| DEAL-01 | 成交单 CRUD（草稿） | P0 |
| DEAL-02 | 提交 / 审批通过 / 驳回 | P0 |
| DEAL-03 | 审批通过联动房客状态 | P0 |
| DEAL-04 | 财务对已审批成交单登记收款 | P0 |
| DEAL-05 | 成交详情展示：应收、已收、未收 | P0 |
| DEAL-06 | 意向金登记与冲抵 | P1 |
| DEAL-07 | 作废成交（admin） | P1 |

**未收** = `commission_total − Σ(confirmed payments.amount)`。  
MVP 允许超收（提示警告，不阻断）。

### 8.5 简易提成 `commissions`

规则（写死，MVP）：

```text
应计提成总额 = commission_total × company_commission_rate
默认 company_commission_rate = 0.5（50% 归经纪人池，其余视为公司留存，不做分摊明细）

经纪人 i 应计 = 应计提成总额 × split_ratios[i] / 100
```

| 字段 | 说明 |
|------|------|
| deal_id | 成交单 |
| user_id | 经纪人 |
| ratio | 分成比例 |
| amount | 应计提成（元） |
| status | `accrued` 已计提 / `paid` 已发放（MVP 发放可手工改状态） |

| ID | 需求 | 优先级 |
|----|------|:------:|
| COMM-01 | 审批通过自动生成应计提成行 | P0 |
| COMM-02 | 经纪人看「我的提成」；店长看本店；财务/admin 看全部 | P0 |
| COMM-03 | 财务可将提成标为已发放 | P1 |

不做：阶梯提成、管理奖、分红分红、跨店合作复杂分账。

---

## 9. 主用户故事（P0）

| US | 角色 | 故事 | 验收要点 |
|----|------|------|----------|
| US-1 | admin | 创建门店与员工并分配角色 | 新账号可登录且数据范围正确 |
| US-2 | agent | 录入房源并上架 | 本店列表可见；他人保密盘不可见 |
| US-3 | agent | 录入私客并写跟进 | 他店/他人私客不可见 |
| US-4 | agent | 创建带看并完成反馈 | 房客详情能看到带看记录 |
| US-5 | agent | 从带看发起成交并提交 | 状态 pending_approval |
| US-6 | store_manager | 审批成交 | 房客变已成交；提成行生成 |
| US-7 | finance | 登记佣金收款 | 未收金额减少 |
| US-8 | agent | 查看本人提成 | 金额与分成比例一致 |

---

## 10. 菜单与页面（信息架构）

```text
登录
└─ 工作台（今日待办 + 盘客存量：在售/私客/公客 — 已落地）
   ├─ 房源
   │   ├─ 房源列表
   │   └─ 房源详情（跟进 / 带看 / 成交）
   ├─ 客源
   │   ├─ 客源列表
   │   └─ 客源详情
   ├─ 带看
   │   └─ 带看列表 / 新建
   ├─ 交易
   │   ├─ 成交单
   │   ├─ 意向金（P1）
   │   └─ 收款流水
   ├─ 业绩
   │   ├─ 我的提成 / 门店提成
   │   └─ 业绩报表（门店月报 + 经纪人排行 — W6 已落地）
   └─ 设置（admin）
       ├─ 门店
       └─ 员工
```

---

## 11. 数据模型关系（逻辑）

```text
companies 1──* stores 1──* users

stores 1──* houses
stores 1──* customers
houses 1──* follows（target_type=house）
customers 1──* follows（target_type=customer）

customer + house ──* views
customer + house ──* deals
deals 1──* payments
deals 1──* commissions
customer + house ──* earnest_moneys（P1）
```

建议实现顺序（表）：

1. companies / stores / users  
2. houses / customers / follows  
3. views  
4. deals / payments / commissions  
5. earnest_moneys  

---

## 12. API 轮廓（自研，勿抄厂商）

统一前缀：`/api/v1`  
鉴权：Bearer Session/JWT；所有查询强制带 `company_id` 隔离。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/login | 登录 |
| GET/POST | /stores , /users | 组织 |
| GET/POST/PATCH | /houses | 房源 |
| GET/POST/PATCH | /customers | 客源 |
| POST | /customers/:id/to-public | 转公客 |
| POST | /customers/:id/claim | 认领 |
| GET/POST | /follows | 跟进 |
| GET/POST/PATCH | /views | 带看 |
| GET/POST/PATCH | /deals | 成交 |
| POST | /deals/:id/submit | 提交 |
| POST | /deals/:id/approve | 审批 |
| POST | /deals/:id/reject | 驳回 |
| GET/POST | /payments | 收款 |
| GET | /commissions | 提成 |
| GET/POST | /earnest-moneys | 意向金 P1 |

错误约定：`401` 未登录 · `403` 无权限 · `409` 业务冲突（如重复提交）。

---

## 13. 非功能（MVP 最低线）

| 项 | 要求 |
|----|------|
| 多租户 | 所有业务表含 `company_id`；禁止跨公司读写 |
| 审计 | 成交状态变更、接盘人变更、收款作废写 audit_log |
| 备份 | 日备数据库（部署文档说明即可） |
| 性能 | 单店 1 万房 + 1 万客列表筛选 < 2s（普通索引） |
| 安全 | 密码哈希；HTTPS（生产）；操作权限服务端强制校验 |
| 客户端 | MVP 可用 Web；现有 Electron 壳可继续包本地页 |

---

## 14. 与当前 `E:\未来家本地` 的落地映射

| MVP 模块 | 现状 | 改造要点 |
|----------|------|----------|
| ORG | 已落地：SQLite 公司/门店/员工 + 4 角色 + 登录哈希；管理员可维护门店/员工（增改启停、重置密码） | 可选：门店人数/角色分布统计增强 |
| HOUSE | 已落地：SQLite 房源 CRUD、状态机、保密盘、组合筛选、接盘人变更、详情时间线、挂接本地楼盘字典、验真状态 | — |
| PROP | 已落地：本地楼盘字典 + 钥匙/实勘·空看/验真（AI-OUT-01/02） | 全国采购库不做 |
| CUS | 已落地：SQLite 客源、公私客、查重软提示、状态机自动推进 | 可选：公客池运营增强 |
| FLW | 已落地：跟进方式/下次跟进日、今日·逾期、作废标记（禁物理删） | — |
| VIEW | 已落地：带看列表/完成态校验/陪看人多选 | — |
| DEAL | 已落地：成交审批/收款/提成/意向金/多经纪人分成 | 见任务板 W2 |
| OFF | 已落地：公告/请假/消息中心/知识库（W5）+ 打卡/招聘/薪酬极简（OUT-06）+ 签署确认/展示隐号/站内群发（OUT-04 本地子集）；消息含钥匙/迟到/群发 | 外勤加班、CA 电子签、真隐号拨打、外网群发（不做） |
| FIN | 已落地：简易收支凭证子集（OUT-05；收入/支出挂门店，非总账） | 完整总账/科目/结转（不做） |
| RPT | 已落地：门店月报 + 经纪人排行 + 盘客存量 + UTF-8 CSV 导出 + 空月引导（W6） | 可选：BI 大屏（OUT） |

建议：主路径 W0～W6 与 OUT-01～06（OUT-04 为本地子集 ✅△）、AUTO-00～12、`npm run health` 已落地；冻结仅剩 **OUT-07（永不）**。第三方电子签/真隐号/外网群发仍不做。质量门禁：`npm run health`（或 `smoke` + `accept`）。

---

## 15. 里程碑与估算（供排期）

| 里程碑 | 交付 | 建议人周（1 全栈参考） |
|--------|------|------------------------|
| M1 | ORG + 登录权限 | 0.5～1 |
| M2 | HOUSE + CUS + FLW（含公私/保密） | 1.5～2 |
| M3 | VIEW | 0.5～1 |
| M4 | DEAL + 收款 + 提成 | 1.5～2 |
| M5 | 主路径验收 + 演示数据 | 0.5 |

合计约 **4.5～6.5 人周** 可做出可演示的 Web MVP（不含漂亮设计与报表大屏）。

---

## 16. 验收检查清单（发布前打勾）

- [ ] 四角色账号均可登录，越权接口返回 403  
- [ ] 私客/保密盘隔离用例通过  
- [ ] 房客跟进带看详情互链  
- [ ] 成交审批联动房客状态  
- [ ] 收款后未收计算正确  
- [ ] 提成按分成比例生成且经纪人可见本人  
- [ ] 明文密码已消除（或明确仅限本地 demo 警告）  
- [ ] 第 1.3 节主路径演示脚本全程通过  

---

## 17. 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| MVP-1.0 | 2026-08-05 | 首版：组织+盘客+带看+成交收款 |
