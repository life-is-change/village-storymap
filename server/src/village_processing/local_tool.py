"""Dependency-free localhost UI for the village V0 processing pipeline."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import webbrowser

from .local_runner import LocalToolConfig, run_local_v0


HTML = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>村规平台数据处理工具</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f6f2;color:#18344a;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif}.shell{max-width:980px;margin:auto;padding:36px 20px}.hero{padding:30px;border-radius:24px;color:white;background:linear-gradient(130deg,#155c37,#45a34b);box-shadow:0 18px 50px #1c6a3c2b}.hero h1{margin:0 0 6px;font-size:30px}.hero p{margin:0;color:#e8f6eb}.card{margin-top:18px;padding:26px;border:1px solid #dfe9e1;border-radius:20px;background:white;box-shadow:0 10px 30px #18344a0d}.step{display:flex;gap:13px;align-items:center;margin-bottom:18px}.n{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:#2f7a2a;color:white;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:grid;gap:5px;font-weight:700;font-size:13px}.wide{grid-column:1/-1}input,select{width:100%;height:43px;padding:0 11px;border:1px solid #cddbd0;border-radius:10px;background:#fbfdfb;color:#18344a}button{border:0;border-radius:11px;padding:12px 20px;background:#21723c;color:white;font-weight:800;cursor:pointer}.actions{display:flex;align-items:center;gap:14px;margin-top:18px}.status{margin-top:16px;padding:14px;border-radius:12px;background:#eef6ef;white-space:pre-wrap}.note{color:#647b89;font-size:13px}@media(max-width:700px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
</style><body><main class="shell"><section class="hero"><h1>村规平台数据处理工具</h1><p>一次生成建筑、道路、水系、等高线和底图预览，输出可由管理员后台直接校验导入的 V0 数据包。</p></section>
<form id="form"><section class="card"><div class="step"><b class="n">1</b><div><b>村庄与范围</b><div class="note">边界支持 GeoJSON 或 Shapefile ZIP，所有数据都按该范围裁切。</div></div></div><div class="grid">
<label>村庄名称<input name="village_name" required placeholder="例如：溪口村"></label><label>英文标识<input name="village_slug" required pattern="[A-Za-z0-9_-]+" placeholder="例如：xikou"></label>
<label class="wide">村庄边界文件路径<input name="boundary" required value=""></label><label class="wide">卫星影像 GeoTIFF 路径<input name="imagery" required value=""></label></div></section>
<section class="card"><div class="step"><b class="n">2</b><div><b>本机数据源</b><div class="note">默认使用工具目录内现有 OSM、哥白尼 DEM 和建筑模型，不会新建 Conda 环境。</div></div></div><div class="grid">
<label class="wide">OSM PBF<input name="osm" value="__OSM__" required></label><label class="wide">哥白尼 DEM<input name="dem" value="__DEM__" required></label><label>模型配置<input name="model_config" value="__CONFIG__" required></label><label>模型权重<input name="model_checkpoint" value="__CHECKPOINT__" required></label></div></section>
<section class="card"><div class="step"><b class="n">3</b><div><b>处理参数与输出</b><div class="note">建筑首次运行需要加载 GPU 模型，可能需要数分钟；页面会持续显示状态。</div></div></div><div class="grid"><label>建筑置信度<input name="building_threshold" type="number" min="0.1" max="0.95" step="0.05" value="0.5"></label><label>等高距<select name="contour_interval"><option value="10">10 米</option><option value="5">5 米</option></select></label><label>等高线平滑<select name="contour_smoothing"><option value="1">开启</option><option value="0">关闭</option></select></label></div><div class="actions"><button type="submit">开始一键处理</button><span class="note">成果保存到 output 文件夹；后台选择解压后的文件夹导入。</span></div><div id="status" class="status">等待开始。</div></section></form></main>
<script>const f=document.querySelector('#form'),s=document.querySelector('#status');let timer;async function poll(){const r=await fetch('/api/status');const j=await r.json();s.textContent=j.message+(j.output?'\\n成果：'+j.output:'');if(j.state==='running')timer=setTimeout(poll,1500)}f.onsubmit=async e=>{e.preventDefault();clearTimeout(timer);const body=Object.fromEntries(new FormData(f));s.textContent='正在启动…';const r=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok){s.textContent='启动失败：'+j.error;return}poll()};poll();</script></body></html>"""


def _defaults(tool_root: Path) -> dict[str, str]:
    building = tool_root / "建筑矢量"
    return {
        "__OSM__": str(tool_root / "道路、水系" / "guangdong-260721.osm.pbf"),
        "__DEM__": str(tool_root / "等高线" / "广东省_哥白尼DEM.tif"),
        "__CONFIG__": str(building / "china" / "mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.py"),
        "__CHECKPOINT__": str(building / "china" / "mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.pth"),
    }


class JobState:
    def __init__(self):
        self.lock = threading.Lock()
        self.value = {"state": "idle", "message": "等待开始。", "output": None}

    def get(self):
        with self.lock:
            return dict(self.value)

    def set(self, **values):
        with self.lock:
            self.value.update(values)


def create_handler(tool_root: Path, jobs: JobState):
    page = HTML
    for marker, value in _defaults(tool_root).items():
        page = page.replace(marker, value.replace("&", "&amp;").replace('"', "&quot;"))

    class Handler(BaseHTTPRequestHandler):
        def _json(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/api/status":
                return self._json(200, jobs.get())
            if self.path != "/":
                return self._json(404, {"error": "NOT_FOUND"})
            data = page.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if self.path != "/api/run":
                return self._json(404, {"error": "NOT_FOUND"})
            if jobs.get()["state"] == "running":
                return self._json(409, {"error": "JOB_ALREADY_RUNNING"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 1024 * 1024:
                    raise ValueError("REQUEST_SIZE_INVALID")
                payload = json.loads(self.rfile.read(length))
                payload["tool_root"] = str(tool_root)
                config = LocalToolConfig.from_dict(payload)
            except Exception as exc:
                return self._json(400, {"error": str(exc)})
            jobs.set(state="running", message="正在处理：建筑 → 道路/水系 → 等高线 → 数据包校验…", output=None)

            def work():
                try:
                    result = run_local_v0(config)
                    jobs.set(state="completed", message="处理完成。请在管理员后台选择成果文件夹导入。", output=str(result.package_dir))
                except Exception as exc:
                    jobs.set(state="failed", message=f"处理失败：{type(exc).__name__}: {exc}", output=None)

            threading.Thread(target=work, daemon=True).start()
            return self._json(202, {"started": True})

        def log_message(self, _format, *_args):
            return

    return Handler


def main() -> int:
    tool_root = Path(__file__).resolve().parents[4]
    # Installed launcher supplies the real tool root; repo execution falls back to cwd.
    import os
    tool_root = Path(os.environ.get("VILLAGE_DATA_TOOL_ROOT", tool_root)).resolve()
    jobs = JobState()
    server = ThreadingHTTPServer(("127.0.0.1", 8031), create_handler(tool_root, jobs))
    threading.Timer(0.7, lambda: webbrowser.open("http://127.0.0.1:8031/")).start()
    print("村规平台数据处理工具：http://127.0.0.1:8031/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
