# 0508 本地运行修复说明

本版本针对 VS Code Live Server 本地运行做了修复：

1. 默认开启 Supabase 云端同步；如果网络环境不稳定，可手动切回本地模式以避免 `WebSocket connection failed`、`ERR_NAME_NOT_RESOLVED` 等报错。
2. 新增本地 `localStorage` 要素保存机制。新建/编辑/删除建筑、道路、农田、公共空间、水体时，即使没有 Supabase，也可以在本机浏览器保存。
3. 修复规划空间中保存新增建筑后，因为云端保存失败导致“保存失败，请查看控制台”的问题。
4. 修复本地模式下保存建筑后，原始建筑图层可能只显示新增对象、不显示原始对象的问题。
5. 保留云端同步开关：当前版本默认连接 Supabase；如需手动恢复云端同步，可在浏览器控制台执行：

```js
localStorage.setItem("village_enable_supabase", "true");
location.reload();
```

如果要切回本地模式：

```js
localStorage.setItem("village_enable_supabase", "false");
location.reload();
```

注意：本地模式保存的数据只存在当前浏览器的 localStorage 中，换电脑或清理浏览器数据后不会同步。教学演示和本地开发推荐使用本地模式；多人协作再开启 Supabase。
