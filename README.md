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

刷新页面后主题偏好会保留，启动脚本会在 CSS 加载前应用已保存主题，避免闪烁。

## 目录结构

```
ui/
  src/
    app/
      theme.ts           # 主题解析与应用
      theme-manager.ts   # 运行时主题状态 + System 模式监听
      theme-transition.ts
      settings.ts        # localStorage 持久化
    styles/
      base.css           # 设计 token 与主题 CSS 变量
      layout.css         # Hermes 聊天界面布局
  public/
    index.html           # 预览页（含 boot script）
    favicon.svg
```

## 测试

```bash
cd ui
npm test
```
