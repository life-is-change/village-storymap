"""Embed exactly five LF-normalized web files in the standalone Aliyun patch."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
import component_frontend_patch as operator


def build(output):
    values = {name: base64.b64encode((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).decode()
              for name in operator.FILES}
    data = json.dumps(values, sort_keys=True).encode()
    code = Path(operator.__file__).read_text(encoding='utf-8')
    code = code.replace("PAYLOAD = ''", 'PAYLOAD = ' + repr(base64.b64encode(zlib.compress(data, 9)).decode()))
    code = code.replace("PAYLOAD_SHA256 = ''", 'PAYLOAD_SHA256 = ' + repr(hashlib.sha256(data).hexdigest()))
    Path(output).write_text(code, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    build(sys.argv[1])
