# Git 主线与日常开发

## 分工

- `main`：统一可检出基线，经过已声明的检查再合入；发布必须记录具体 commit 或 tag。
- `codex/<功能名>` 或个人功能分支：从最新 main 创建，一次处理一项可说明的改动。
- `learning`、日期分支和旧 Worker 分支：保留为历史，不再作为新的发布来源。保留分支并不表示其中功能应覆盖 main。
- `vYYYY.MM.DD[-序号]` 标签：固定一个已经提交且验证的版本。标签需要单独推送，不标记未提交文件。

## 日常步骤

以下命令在当前工作区没有未提交变更时使用；若已有改动，先保存和核对，不要通过 reset/clean 丢弃。

```bash
git switch main
git pull --ff-only
git switch -c codex/your-feature
```

完成一个小改动后，先检查，再按明确文件提交：

```bash
npm test
git diff
git add path/to/changed-file path/to/its-test
git commit -m "fix: explain the concrete problem and change"
git push -u origin codex/your-feature
```

在 GitHub 发起 `codex/your-feature → main` 的 PR，写明变化、验证和限制；合并后更新本地 main。这里的 main 是稳定基线，不要求直接在 main 上开发。

## 第一次主线整理

原远端 main 只有 README，与 learning 没有共同祖先。本次从原 main 创建整理分支，导入当前平台工作树，再经 PR 建立完整 main。没有重写历史，没有强推，没有删除旧分支。

本地整理前的工作状态保存在 `codex/pre-mainline-20261008`；历史 learning 的旧提交也继续保留。忽略规则只隐藏实验包和缓存，不删除本地文件。六服务发布 ZIP、会议材料、重复源码包和原始测量留在本地；部署源码、必要静态资源与测试进入 main。

## 哪些内容不提交

- `.env`、`gpu.env`、账号凭据、服务器专属配置。
- `node_modules`、Python 缓存、临时测试目录。
- `discussion-delivery-20261007` 和 `release-transfer` 中的本地交付副本、访谈材料、压缩包和大型 Git bundle。
- GPU 权重、运行结果及数据库导出。它们应有独立备份，不能仅依赖 GitHub。

必要的 `homepage/dist` 和 Cesium 静态运行时仍入库，否则检出后无法直接打开完整平台。

## 维护规则

1. 一个可独立说明和验证的修改对应一次或少量提交，不必等数周才做一次“大备份”。
2. `commit` 只保存在本机，`push` 才同步 GitHub；确认当前分支跟踪正确远端。
3. 新机器只需检出 main；复现旧版使用日期分支或标签，不复制一个新仓库文件夹。
4. 服务器部署记录实际 commit 和配置模板版本。代码已更新不等于旧 Docker 容器已更新。
5. main 的必要检查和已知限制写在 README；新功能涉及身份、权限或 GPU 时，额外执行对应验证。
6. 暂不删除日期分支、不做历史压缩、不执行强制推送；这些是单独的维护动作。
