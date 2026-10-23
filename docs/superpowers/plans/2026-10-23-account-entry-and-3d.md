# 新账号首次地图与3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline and one fresh whole-change review. Keep the user-authorized original main checkout.

**Goal:** 修复首次地图请求误过期与3D空间接口误判，保留服务器权限。

**Architecture:** 请求scope排除后台个人图底ID；3D仅对明确成果版本标记选择personal协议；独立网页覆盖层应用。

**Tech Stack:** Browser JS/Node VM regression, Python deployment, Docker Compose, isolated native CI.

**Spec:** docs/migration/2026-10-23-account-entry-and-3d.md

## Global Constraints

- 原项目main，不切分支/worktree，保留未提交修改。
- 不修改数据库权限、函数或业务行，不改4090镜像/私钥/模型。
- Auth/当前工作区变化仍拒绝过期响应；403不能吞掉。
- 新覆盖层验证所有历史回执/摘要，自身备份，仅更新web。

## Review Focus

- 后台personalSpaceId初始化不能让公共地图请求失败。
- 真实user/project/village/course/space改变仍必须拒绝旧响应。
- practice/formal个人体验与明确图底版本空间不可混淆。
- 未授权personal接口仍把403传给调用方。
- 重复发布与中断恢复不能修改旧覆盖层或其他服务。

### Task 1: 首次加载与3D路由

Files: features/integration/deployment-routing.test.js; features/3d/personal-building-routing.test.js; features/data/unified-api-client.js; app-3d.js.

- [x] 写首次公共地图读取期间初始化personalSpaceId的失败测试及跨村庄/课程拒绝测试。
- [x] 写普通practice/formal个人空间走planning读取、成果空间走personal、403仍传递的失败测试。
- [x] 最小修复scope与3D判别；运行针对与全套JS回归。

### Task 2: 云端网页更新与交付

Files: linux/scripts/repair-autonomous-account-entry.py; linux/tests/test_autonomous_account_entry_repair.py; linux/scripts/test-autonomous-deployment-ci.py; migration record.

- [x] 测试精确历史task-lock覆盖层可验证，篡改必须拒绝；预检不写数据。
- [x] 自身备份后复制网页、只替换两个文件、web-only重建、HTTPS字节与其他容器ID保持，重复执行可恢复。
- [ ] 隔离原生CI验证已有SQL不变、历史网页不变、重复apply；全部验证通过后记录并提交。
- [ ] 独立整体验证审查，修正实质问题；推送main并给用户阿里云一行命令及新账号复测步骤。
