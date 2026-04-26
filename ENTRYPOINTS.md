# Entrypoints (Single Source of Truth)

这个项目里有多个 `index.html`，但它们不是同级入口。根目录 `/index.html` 是唯一的整合平台入口，其余 `index.html` 都是被主平台引用的子页面或工具页。

## Entry Map

| File | Role | Open directly? | Notes |
| --- | --- | --- | --- |
| `/index.html` | 主平台入口 | Yes | 整合地图、首页 iframe、2D/3D 视图和身份桥接逻辑。 |
| `/homepage/index.html` | 首页源码开发入口 | Only for homepage dev | Vite 使用它加载 `/homepage/src/main.tsx`。它不是整合平台入口。 |
| `/homepage/dist/index.html` | 首页构建产物 | No, normally embedded | 被 `/index.html` 里的 `#homeLandingFrame` iframe 加载。需要从 `/homepage/index.html` 重新构建。 |
| `/rural_house_generator/index.html` | 住宅生成器独立工具页 | Yes, as a tool | 从 3D 面板打开，不是整合平台入口。 |

## Critical Linkage

Do not break these flows:

1. `/index.html` embeds `/homepage/dist/index.html` through `#homeLandingFrame`.
2. `app.js` bridges homepage login/register buttons to the root identity modal.
3. Homepage buttons labeled `进入互动平台` / `立即进入平台` jump from the embedded homepage into platform views.
4. `app-3d.js` opens `/rural_house_generator/index.html` as a standalone generator tool.
5. 2D and 3D mode switching stays controlled by the root app shell.

## Encoding Rule

All source files should be saved as UTF-8. If Chinese appears as mojibake in PowerShell, read with explicit UTF-8, for example:

```powershell
Get-Content -Encoding UTF8 homepage\index.html
```

## Change Rule

Any task that does not explicitly require entry restructuring must not replace, rename, or repoint `/index.html` as app entry.

