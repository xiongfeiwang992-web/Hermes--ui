# Open Real Estate Brokerage System

中文房产中介业务系统，基于 **TypeScript + SQLite + Electron**。可在浏览器中运行本地工作台，也可使用 Electron 桌面端处理本机附件。

本项目源码采用 [MIT 许可证](LICENSE)，不依赖 Cursor 会员。当前为 **0.1.0 开源预览版**，适合本地试用、学习与二次开发，不代表已完成生产安全审计或第三方服务接入。

## 业务能力

| 范围 | 已有本地功能 |
| --- | --- |
| 房源与客源 | 录入编辑、筛选导出、楼盘字典、公私盘客、电话脱敏、跟进、带看、钥匙、验真、委托 |
| 成交与财务 | 成交审批、收款确认、意向金、退款、提成、按揭与过户节点、报销、资产、备查凭证 |
| 团队与办公 | 组织权限、考勤请假、招聘入职、员工合同、薪酬、离职交接、公告、知识库、会签、工作总结 |
| 其他业务 | 租赁托管、新房分销、营销线索、客户关怀、积分与业绩、站内消息、审计、备份 |

主要角色为管理员、店长、经纪人和财务。业务权限在服务端执行；具体字段、规则与边界见 [实现状态与外部依赖](docs/实现状态与外部依赖.md)。

## 快速开始

需要 **Node.js 22.x**、npm 和 Git。使用 `better-sqlite3` 原生模块；如环境无法下载对应预编译包，需要本机 C++ 构建工具。

```bash
git clone https://github.com/xiongfeiwang992-web/Open-Real-Estate-Brokerage-System.git
cd Open-Real-Estate-Brokerage-System
npm ci
npm run build
npm run seed
npm run start:web
```

打开 **http://127.0.0.1:8787**。网页与 API 由同一进程提供，只监听本机，不会自动公开到互联网。

`npm run seed` 仅用于首次初始化演示库。数据库已存在时会拒绝覆盖；日常启动不需要再次运行。业务数据默认位于 `data/app.db`，升级或迁移前请先备份整个数据目录。

### 演示账号

以下账号密码均为 `123456`，仅供本机演示，不要用于公网环境。

| 账号 | 角色 |
| --- | --- |
| `admin` | 管理员 |
| `manager` | 一号店店长 |
| `agent_a` / `agent_b` | 一号店经纪人 |
| `finance` | 财务 |
| `agent_c` | 二号店经纪人，用于隔离测试 |

主流程：登录 → 房源 → 客源 → 跟进 → 带看 → 成交 → 店长审批 → 财务确认收款 → 提成。

### 开发与桌面端

两个终端分别运行 `npm run dev:server` 和 `npm run dev:renderer`，打开 **http://127.0.0.1:5173**。Vite 将 API 请求转发到本机后台。

`npm run dev` 启动开发版桌面环境，`npm start` 构建并启动 Electron 与 API。桌面功能依赖图形环境；首次启动前先初始化演示库。网页端不具备 Electron 本机文件选择能力。

保留 `WEILAIJIA_DB`、`WEILAIJIA_API` 等旧环境变量以及客户端存储键，以兼容原有数据和配置。`PORT` 可调整网页/API 端口，例如 Windows PowerShell：

```powershell
$env:PORT = '8788'
npm run start:web
```

## 验证

```bash
npm run build
npm run health
```

构建包含后台、桌面端和前端 TypeScript 检查。健康检查自动发现 `scripts/*-smoke.ts`，覆盖业务主链路、权限、状态流转、通知、导出、网页启动和初始化数据保护。测试使用 `data/` 内的独立测试库，不应对真实业务库调用测试夹具。

GitHub Actions 在 Windows 与 Linux 上执行相同检查。测试通过不等同于每个页面、每个平台或生产部署均已人工验收。

## 边界与安全

- CA 电子签、运营商真隐号、外网平台、地图、微信、短信、分销小程序、财务总账等只是默认关闭的配置边界，需要合法供应商服务与后续联调。
- 本地签署确认不是第三方 CA 签章，备查凭证不是完整会计总账。
- 这是本地单机部署方案。公网服务、多租户托管、移动独立客户端和桌面安装包分发需要额外工程工作。
- 不上传真实客户、合同、附件、数据库、密钥和日志。上线前请阅读 [安全说明](SECURITY.md)。

## 目录与贡献

`server/` 业务内核；`renderer/` 中文工作台；`electron/` 桌面壳；`migrations/` 数据迁移；`scripts/` 测试与启动；`docs/` 需求和实现记录。

欢迎通过 Issue 与 Pull Request 参与，提交前请阅读 [贡献指南](CONTRIBUTING.md)。本仓库保留原 `Hermes--ui` 的提交历史及云端功能分支整合记录，历史文档中的旧项目名称仅为来源记录。

第三方依赖仍受其各自许可证约束。请勿提交无权分发的商业软件或私有实现。
