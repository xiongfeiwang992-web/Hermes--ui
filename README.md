# Hermes UI

基于 [OpenClaw](https://github.com/openclaw/openclaw) 控制面板主题体系的 Hermes 界面主题库。

## 主题

- **Hermes**（默认）— 深海军蓝 + 金色强调色
- **Claw** — OpenClaw 经典红色主题
- **Knot** — 纯黑底 + 深红强调色
- **Dash** — 深可可色 + 巧克力棕强调色

支持 **System / Light / Dark** 三种模式，以及 **90%–125%** 文字缩放。详见 [THEMES.md](./THEMES.md)。

## 快速预览

```bash
npm install --prefix ui
npm run dev
```

或在仓库根目录：

```bash
npm run dev
```

在输入框中可试用 slash 命令，例如 `/theme hermes`、`/theme dark`。

## 作为库使用

```ts
import { createThemeManager, parseThemeCommand } from "hermes-ui";

const themeManager = createThemeManager();
themeManager.applyCommand("/theme claw");
```

## 目录结构

```
ui/
  index.html
  src/
    index.ts           # 公共导出
    main.ts            # 预览应用入口
    app/
      theme.ts
      theme-manager.ts
      theme-command.ts # /theme 命令解析
      theme-boot.ts    # 启动时无闪烁主题
      settings.ts
    styles/
      base.css
      layout.css
  public/
    favicon.svg
    manifest.webmanifest
```

## 测试

```bash
npm test
```
