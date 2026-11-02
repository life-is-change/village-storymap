# 村庄日常早市实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在真实和虚拟村庄的完整一天内运行具有真实尺度的乡村早市。

**Architecture:** MarketDesign输出米制混合摊位；DailyMarket控制器消费既有Life人物与时钟，通过Life路径和任务完成接口进入、接待、购买、返家。Schedule安排家庭购物与摊主工作，编译器保留人口和完整日历。

**Tech Stack:** 现有无构建JavaScript、Node test、Cesium、原创GLB。

**Spec:** docs/superpowers/specs/2026-11-02-daily-market-design.md

## Global Constraints

- 原目录main工作，保留既有未提交内容，不创建工作树。
- 同一人物、同一时钟；06:30开市、09:30停止新接待、10:00收市，继续全日。
- 保留家庭、学校与硬性岗位安排；不强制人口18、天数1或游客0。
- 不依赖外部素材和新运行库，不扩展支付或库存经济。

## Review Focus

- 多天运行：清空前一天队列与购买状态，人物数量不增加。
- 接送与工作冲突：没有分身，购物不占用必要安排。
- 道路断开、无人到岗、早到与晚到：无虚假交流或购买。
- 不同场地与旋转：摊位、脚点和路径落在实际米制边界内。
- 老保存与浏览器缓存：入口移除、旧市场建筑转换，已有设计不被替换。

### Task 1: 共用米制混合摊位

Files: village_game/domain/market-design.js及测试；views/catalog.js及测试；3D_scenes_edit/domain/market-preset.js及测试；assets/market生成器与模型。
Interfaces: MarketDesign.stalls(width,depth)返回{id,x,y,width,depth,height,style,produceKind,headingDeg}[]；Catalog.structure消费相同数据。
- [ ] 先测试不同尺寸数量变化、三种摊型、边界和开放市场无建筑体积，确认失败。
- [ ] 实现共用布局和多种高度的细节模型；真实预设引用相同尺寸与摊型。
- [ ] 运行布局、模型、目录和预设检查，通过后提交。

### Task 2: 全日人物与早市行为

Files: domain/daily-market.js及测试、schedule.js、life.js、simulation.js、observation.js。
Interfaces: DailyMarket.create({scene,agents,move,finish,path,log})；reset(day)、enter(agent,minute)、tick(agent,minute)、result()；不创建人物或推进时钟。Schedule生成market-vendor和market-shop任务。
- [ ] 先测试同人口、06—24时、早餐后买菜、交流后返家及继续作息、多天重置、缺经营者与断路，确认失败。
- [ ] 在Life任务状态机接入控制器，实际路径穿过入口与场内避障；购买计入家庭与市场摘要。
- [ ] 运行全日、家庭、学校、确定性和早市回归，通过后提交。

### Task 3: 两个平台的日常入口、绘制与保存

Files: app.js、index.html、domain/scene.js、views/scene3d.js、integration/plan-adapter.js、workspace.js、session.js、loader.js及相关测试、根index.html。
Interfaces: 编译真实市场为dailyMarkets描述并交给Life；工作区保留完整周期结果并附带市场摘要；虚拟主视图绘制混合市场并支持定位。
- [ ] 先测试启用市场不改人口/天数/游客、无独立实验按钮、旧保存市场使用开放模型，确认失败。
- [ ] 删除产品的独立早市入口，配置内嵌市场；补充默认市场和早市观察时段，不覆盖保存设计。
- [ ] 运行完整npm test、两种场景浏览器实测，记录结果。

### Task 4: 复核与发布

- [ ] 一次独立整体代码复核，修复重要问题并运行回归。
- [ ] 固定提交、哈希预检、备份和可回滚发布；不得覆盖线上方案或服务器专用配置。
- [ ] 正式页面核验两个入口、尺寸、买菜后继续生活；记录发布版本与验证边界。
