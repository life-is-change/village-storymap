# 公网入口、照片与课件修复

## 第三次公网反馈：H001 删除缺少校核索引、对象留言误走旧客户端

用户返回的只读统计为 H001_FEATURES=15、H001_REVIEWS=0、H001_WITH_REVIEW=0；共享空间中 H001 只有一条，有一份初始快照及一个已发布的数据集。这说明已有矢量并不保证已建立校核记录，之前的 TEST 探针仅验证新建对象，未覆盖这条旧数据。网页正确保留了 SURVEY_FEATURE_NOT_FOUND 检查；本修复不取消它，也不在网页补造版本号。

v3 预检再次要求 H001 只有一个共享上下文，且精确匹配历史迁移定义的米埗村练习共享空间、项目、村庄、已发布数据集，以及**同一上下文**的未删除初始快照项；全库中有一份同名快照不够。实施先取得本机完整备份，再在事务与锁保护下，仅为缺失的 H001 插入一条 V0 待校核记录（pending、修订 0、无确认人），不把它记为新增或已确认。已有校核记录不会被重置；若随后用户保存删除，重复运行仍保留 deleted 与新修订。其他空间同名建筑、原建筑几何、照片、快照和编辑历史不作修复性修改，删除仍由用户在网页取得锁、填写原因并保存，产生正常版本记录。

截图中的 SOURCE_BUSINESS_DISABLED 是另一条独立问题：对象留言模块已支持 survey 接口，但 app.js 与 object-info-deps.js 没有传递 services。现在补齐两处依赖传递，读取、留言、点赞、回复均使用阿里云接口；源站模式仍使用原客户端，源业务访问保护保持启用。

执行仍为本文下方相同的 git pull、repair-autonomous-browser.py 预检和 --apply。v3 核验 v1/v2 回执后生成独立 files/browser-20261022-v3/web，保留前两版修复，额外发布 app.js 和对象留言依赖模块；无需镜像或重新迁移。预检同样核对 H001 的完整范围，范围不匹配会停止。成功标记为 h001_review_and_local_comments_repaired_browser_check_required。Ctrl+Shift+R 后重新选择 H001 删除并保存，再验证刷新和3D；旧的未保存编辑请先放弃后重做。

本地回归：1076 项 JavaScript、395 项 Python 通过，6 项 Windows/POSIX 差异跳过。数据库/部署集成加入专用旧 H001、外空间快照拒绝、只读预检、待校核补齐、无锁删除拒绝、有锁删除成功、删除版本留存、原照片摘要不变及重复运行不复活。

提交 `3b06fa9` 的 [数据库与部署集成测试](https://github.com/life-is-change/village-storymap/actions/runs/39757168128)和[平台回归](https://github.com/life-is-change/village-storymap/actions/runs/39757168161)均成功。原生数据库任务实际输出 H001_BASELINE_REPAIR_LEASED_DELETE_HISTORY_AND_REPEAT_VERIFIED，并完成 114 表备份恢复、重启和 1/5/10/20 并发测试；没有调用真实 CA、提供商或4090。真实阿里云执行及浏览器验收仍待用户返回，不将 CI 成功写成实际网站验收。

## v2 历史记录

## 第二次公网反馈：照片 FORBIDDEN 与已删除建筑在3D复活

v2 保留 v1 的课件/入口修复。管理员取得全部照片元数据后，页面曾以 Promise.all 下载每张原图，一张拒绝就使整个列表失败。旧照片可能没有完整上下文；管理员对这些已登记照片的审核读取未单独放行。现在仅对活跃管理员放行已有 object_photos 记录所关联的旧 Storage/新照片文件，不放行未关联文件、不改变学生和教师的空间隔离，也不改动上传写权限。单图读取失败仍展示记录和错误类别，不再把整页判成照片查询失败或声称文件丢失。

删除二维建筑后旧模型复活的根因是 Aliyun 3D 请求 planning.listFeatures 时遗漏 includeDeleted。没有收到删除标记，合并静态建筑底图时就把原建筑重新补回来，并恢复旧绑定模型。v2 请求包含删除标记，沿用既有合并、加载清理和模型绑定逻辑；只隐藏当前视图中已删除建筑，不删除素材与历史模型。新增 B-N-… 是对象内部编号，其规范化显示形式不是报错。上传删除后重新上传路径另加入真实本地文件服务回归，不做无证据的上传行为更改。

已经安装 v1 的主机仍执行下方同一组预检/--apply 命令。工具先核对 v1 回执、补丁清单和网页树摘要，再建立独立的 files/browser-20261022-v2 目录，保留 v1 及原包；原数据库的四个读取函数以原始或已应用正文校验后，在一个事务中替换。新网页仅替换 admin.js、app-3d.js、入口适配器和七份课件。成功标记变为 photo_permissions_and_deleted_building_handoff_repaired_browser_check_required。无需传新镜像或重跑迁移。

刷新后核对：照片列表可读，单图异常不影响其余行；二维已删建筑及模型在3D消失，新增矢量白模仍在；切回二维、刷新再进三维仍一致。4090接入保持暂停。

### 提交和验证记录

- `fa02f9f`：入口参数投影、照片时间字段兼容、七讲 PDF 打包，以及 v1 部署工具。用户已确认 PDF 和 INVALID_INPUT 问题解决。
- `6a1a68b`：管理员照片读取、单图错误隔离、3D 删除标记，以及带原始版本核验的 v1 → v2 升级。
- `13b8cc0`：集成测试补齐旧照片的显式登记。此前测试访问的是没有照片记录关联的 Storage 对象，修复后继续拒绝属于正确权限行为；本提交保留未登记对象拒绝用例，再验证已登记照片允许读取，没有削弱权限规则。
- 本地验证：1074 项 JavaScript、393 项 Python 测试通过，6 项因 Windows/POSIX 差异跳过。
- 精确提交 `13b8cc0` 的 [数据库与部署集成测试](https://github.com/life-is-change/village-storymap/actions/runs/39749716852)、[平台回归](https://github.com/life-is-change/village-storymap/actions/runs/39749716881)、[Pages 构建](https://github.com/life-is-change/village-storymap/actions/runs/39749715972)均成功。数据库测试验证管理员读取、学生/教师拒绝、删除照片后重新上传、v1 → v2 升级、重复运行、HTTPS 文件摘要及备份恢复；3D 删除场景通过真实前端函数与合并器回归验证。
- 集成环境没有调用真实 CA、付费提供商或4090。v2 阿里云执行结果及浏览器验收仍待用户返回；不得将 CI 成功记成真实网站验收完成。

## v1 历史记录（当前执行使用上方 v2 说明）

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
