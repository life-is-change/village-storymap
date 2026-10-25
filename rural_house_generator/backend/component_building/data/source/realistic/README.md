# 写实农房资源记录

资源来自 Poly Haven 的 CC0 扫描材质与环境，均为 1K，本地使用，无付费 API。逐文件下载地址、来源页面、尺寸和 SHA256 见 manifest.json。

- painted_plaster_wall：墙面颜色、OpenGL 法线、ARM。颜色经 modeling/realistic_materials.py 在 Blender 中处理为干净米白墙漆，线性 RGB 使用 0.55 + 0.30 × 源颜色；保留源法线和粗糙度。平台 Worker 将派生颜色图写入当前任务 artifacts/material-cache/rural-realistic/，不修改安装目录。
- clay_roof_tiles_02：陶瓦颜色、OpenGL 法线和粗糙度。屋面贴图按约 2.5 m 重复尺度布置。
- overcast_soil：真实环境 HDRI。保留供 Blender 渲染使用；平台构件链路只导出 GLB，网页沿用平台预览灯光，HDRI 不随 GLB 自动携带。
- white_plaster_02：实验时下载的备选材质，本轮最终方案未使用。保留来源记录，未混称为当前输出。

来源：https://polyhaven.com/a/painted_plaster_wall 、https://polyhaven.com/a/clay_roof_tiles_02 、https://polyhaven.com/a/overcast_soil 、https://polyhaven.com/a/white_plaster_02 。许可说明：https://polyhaven.com/license 。

墙面物理重复尺度约 2 m；白墙颜色、金属栏杆、玻璃与构件尺寸仍包含设计预设，不能视为照片逐项实测。
