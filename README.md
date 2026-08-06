# Hermes UI

基于 [OpenClaw](https://github.com/openclaw/openclaw) 控制面板主题体系的 Hermes 界面主题库。

## 主题

- **Hermes**（默认）— 深海军蓝 + 金色强调色
- **Claw** — OpenClaw 经典红色主题
- **Knot** — 纯黑底 + 深红强调色
- **Dash** — 深可可色 + 巧克力棕强调色

支持 **System / Light / Dark** 三种模式。详见 [THEMES.md](./THEMES.md)。

## 快速预览

```bash
cd ui
npm install
npm run dev
```

## 目录结构

```
ui/
  src/
    app/theme.ts      # 主题解析与应用逻辑
    styles/base.css   # 设计 token 与主题 CSS 变量
  public/index.html   # 主题预览页
```

## 测试

```bash
cd ui
npm test
```
