# 公网入口、照片与课件修复

真实公网反馈：管理员认证成功但首页/进入平台报 INVALID_INPUT；照片管理 DB_UNAVAILABLE；理论课 PDF 显示缺失。内部探针之前直接调用窄参数接口、测试照片表有 created_at，且未检查课件静态发布，因此未覆盖这些问题。

根因与修复：VillageClient.listSpaces 现在仅发送 teachingProjectId/villageId，丢弃页面 villageRole 等非接口字段，服务端严格校验保持原样。照片读取兼容真实 uploaded_at 和旧测试 created_at 两种结构；用户列表补回注册时间。网页打包只额外允许 assets/lessons/lesson01.pdf 至 lesson07.pdf。

当前已上线 f4 包无需重传镜像、重新导入或再次切换。执行：

```bash
cd ~/village-deploy/source &&
git pull --ff-only origin main &&
python3 linux/scripts/repair-autonomous-browser.py &&
python3 linux/scripts/repair-autonomous-browser.py --apply
```

预检只读，实施先做本机完整备份（短暂停写并恢复 API/Auth），再原子替换两个读取函数；原函数正文必须与冻结发布一致或已应用同一补丁。权限、所有者、业务行和原始照片文件保持原样。它从原网页复制一份单独的覆盖目录，仅更新入口适配器、补齐七份 PDF；compose 只更换网页只读挂载并以 --no-deps 重建 web，原发布目录和控制器摘要保持不变。API/Auth/PG 容器 ID 必须保持原样。通过有效 TLS 核对八份静态资源完整摘要。修复目录位于已纳入每日备份的 files/browser-20261022-v1。

成功标记：browser_entry_photos_lessons_repaired_real_browser_check_required。浏览器 Ctrl+Shift+R 后验证登录、进入平台、照片管理和七讲 PDF。不要重跑初次安装器或 --apply 公网切换命令。本工具可在完成后重复校验，源补丁不符、未知函数正文、未知挂载、空间不足时停止并保留现场。未完成的覆盖目录会明确停止，不自动清理或重建；如出现 STOP 只提供 category，不发送私有业务行。

恢复资料：修复目录的 original-compose.json 保留原网页挂载，receipt.json 保存修复前备份位置、补丁文件摘要及阶段，overlay-proof.json 保存新网页完整摘要；原版本保留在 releases 中。备份在新机器恢复后应从受控 Git 版本核对本修复及证书维护钩子。该修复不更改当前 immutable release ID，审计时需同时核对原发布摘要和补丁回执。

GitHub Pages 源站继续走 Supabase；入口参数投影仅发生在本地服务分支。现有两个 Auth、队列后端的选择与4090模型/Worker配置均未改变。本修复仍不能替代实际GPU验收。
