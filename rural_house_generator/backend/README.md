# 本地实景立面生成服务

## 一键启动

在仓库根目录双击 `start_facade_generator.bat`。脚本会在后台启动 8011 处理服务和 8000 静态页面服务，完成健康检查后输出生成器地址。页面提示“本地处理服务未启动或不可访问”时，应先运行该脚本。

上传照片和生成产物默认保存在源码目录之外的
`%LOCALAPPDATA%\VillageFacadeGenerator\runtime_storage`。这样开发服务器不会因任务文件变化而自动刷新生成器页面。Linux 默认使用用户缓存目录，也可通过 `RURAL_FACADE_RUNTIME_ROOT` 指定位置。

当前流程接收建筑实拍图，先在本地生成单一全局 H0 正立面结果，再由学生设置屋顶下沿，最后使用 Blender 将墙身贴到白模正面。

## 本地环境

- Conda 环境：`E:\anaconda3\envs\building_facade_pilot`
- Blender：`D:\Blender\blender.exe`
- Python：3.12

创建环境：

```powershell
$env:CONDA_PKGS_DIRS='E:\anaconda3\envs\.conda_pkgs_facade_pilot'
$env:CONDA_REGISTER_ENVS='false'
E:\anaconda3\Scripts\conda.exe create -p E:\anaconda3\envs\building_facade_pilot python=3.12 pip -y
E:\anaconda3\envs\building_facade_pilot\python.exe -m pip install -r rural_house_generator\backend\requirements-baseline.txt
```

这里使用专用包缓存，是因为当前 `E:\anaconda3\pkgs` 只允许管理员写入；无需修改
全局 Anaconda 目录权限。跳过环境登记是因为当前用户的 `.conda\environments.txt`
混用了 GBK 与 UTF-8 编码；该开关不修改原文件，环境仍可通过完整路径正常使用。

后端实现完成后，从仓库根目录启动：

```powershell
$env:BLENDER_EXECUTABLE='D:\Blender\blender.exe'
E:\anaconda3\envs\building_facade_pilot\python.exe -m uvicorn rural_house_generator.backend.app.main:app --host 127.0.0.1 --port 8011
```

健康检查地址：`http://127.0.0.1:8011/health`。

另开一个终端，从仓库根目录启动静态页面：

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000/rural_house_generator/index.html`，切换到“实拍图贴图”：

1. 上传一张建筑实拍 JPG 或 PNG，等待本地正立面预处理完成。
2. 在正立面结果上把青色分界线拖到屋顶下沿；豆包入口仅作为备用。
3. 填写建筑长宽、楼层数和层高，选择四坡、双坡或平屋顶，再点击上传卡片内的“按当前主体范围生成模型”。
4. 生成后可下载 GLB；从主 3D 页面打开时，也可沿用原有“替换原建筑”回传协议。

浏览器在创建任务后先调用 `POST /api/jobs/{job_id}/rectify`，随后调用
`POST /api/jobs/{job_id}/prepare-direct`，按学生设置的上边界去掉照片屋顶并自动收紧左右背景空白。旧的
`POST /api/jobs/{job_id}/prepare` 四角接口暂时保留用于兼容既有测试或调用方，
但当前页面不再使用它。

## 输入与限制

- 仅支持一张 JPEG / PNG，且不超过 10 MB。
- 裁切后的墙身图片贴到前墙；侧墙和后墙为中性白色，顶部生成独立四坡、双坡或平屋顶。
- 当前墙身为矩形白模，屋顶是参数化简化几何，尚未按真实矢量轮廓或照片内容恢复细节。
- 本地会执行基于建筑线条的全局透视校正；遮挡清理和复杂目标建筑分割仍受照片质量影响。

任务与产物保存在运行目录的 `<job-id>/` 子目录。需要清理时，只删除已确认的具体任务 ID 目录；不要对整个运行目录、仓库或环境目录执行递归清理。
