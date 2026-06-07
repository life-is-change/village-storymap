# Homepage

这个目录是主平台首页的 React/Vite 子项目，不是整个村庄规划互动平台的主入口。

## 文件角色

- `index.html`：Vite 开发入口，加载 `src/main.tsx`。
- `src/`：首页 React 源码。
- `dist/index.html`：首页构建产物，被根目录 `/index.html` 通过 iframe 嵌入。

## 与主平台的关系

主平台入口固定为项目根目录的 `/index.html`。根页面中的 `#homeLandingFrame` 加载 `homepage/dist/index.html`，然后由根目录 `app.js` 负责登录/注册按钮、身份状态和“进入互动平台”跳转的桥接。

如果只改首页内容，应改 `src/` 和 `homepage/index.html`，然后重新构建 `dist/`。不要把 `homepage/index.html` 当成整合平台入口。

## 编码

所有文件按 UTF-8 保存。如果在 PowerShell 里直接 `Get-Content` 看到中文乱码，请改用：

```powershell
Get-Content -Encoding UTF8 homepage\index.html
```

