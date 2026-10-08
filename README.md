# 村庄规划互动平台

本仓库保存教学平台的前端、数据访问逻辑、数据库迁移 SQL，以及 Linux GPU Worker 的部署源码。`main` 是今后开发和发布的统一基线；历史日期分支保留供追溯。

## 打开平台

唯一整合入口是根目录 **`index.html`**。在 VSCode 中打开仓库，使用现有 Live Server 服务该入口，或在仓库根目录执行：

```bash
python -m http.server 5501 --bind 127.0.0.1
```

浏览器访问 `http://127.0.0.1:5501/`。请使用 HTTP 服务而非双击文件。网页可以在本机运行，但登录、业务数据和 GPU 调度仍连接现有 Supabase；这不是离线数据库版本。首页嵌入 `homepage/dist/index.html`，不要把 `homepage/index.html` 当成整合入口。

## 目录

| 路径 | 内容 |
| --- | --- |
| `index.html`、`app.js`、`app-3d.js`、`style.css` | 整合平台和二维／三维入口 |
| `homepage/src`、`homepage/dist` | React 首页源码及当前静态产物 |
| `features` | 认证、课程、村庄、数据、协作、地图和界面模块及测试 |
| `assets`、`data` | 平台必要静态资源，包括固定版本 Cesium |
| `3D_scenes_edit`、`rural_house_generator` | 场景编辑和住宅生成相关源码 |
| `supabase_SQL`、`supabase/functions` | 数据库迁移与服务函数源码 |
| `server` | Python GPU Worker 与服务源码、配置模板和测试 |
| `linux` | Docker、Compose、部署说明与检查脚本 |
| `docs` | 架构、操作说明、历史开发计划和 Git 工作流程 |

## 验证

需要 Node.js 22 或更新版本；根目录测试不需要安装第三方 Node 依赖：

```bash
npm test
```

它执行平台已有 JavaScript 回归测试，不启动云端任务，不修改数据库。

GPU 部署入口见 [linux/README.gpu.md](linux/README.gpu.md)；Python 环境和模型依赖见 `server`、`linux` 文档。不要把整个源码目录作为公网 Web 根目录：部署静态文件应使用 `linux/scripts/stage-web.py` 的筛选逻辑。

## Git 与版本

阅读 [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)。新功能从 `main` 建短期分支，经检查和 PR 合入主线；重要版本用标签标记。GitHub 保存代码和版本，不替代数据库、上传照片、GPU 模型或服务器运行数据的备份。

## 2026-10-08 基线状态

- 纳入现有工作区的入口修复、加载优化、本地 Cesium 和六服务 GPU 部署文件。
- 根入口、首页布局及业务数据协议保持当前行为；本次整理没有迁移 PostgreSQL 或阿里云。
- 完整 TypeScript 检查存在既有 UI 类型依赖错误；本次前后诊断相同，不能把 JavaScript 回归通过视作 TypeScript 全量构建通过。当前首页静态产物使用 `homepage/vite.entry-validation.config.mts` 构建，绕过缺少依赖的开发检查插件。
- 云端个人图底初始化曾返回 `PGRST202`，网络加载延迟仍存在；自动测试不证明线上所有可选功能健康。
- GPU 权重、服务器 `.env` 和运行目录不入库。部署它们需要另行准备。

入口约束见 [ENTRYPOINTS.md](ENTRYPOINTS.md)，修改边界见 [CHANGE_GUARD.md](CHANGE_GUARD.md)。
