"""Web GLB texture budget; keeps geometry/UV/material bindings and a full texture copy."""
import io
import hashlib
import json
import struct
from pathlib import Path

from PIL import Image


def optimize_web_glb(path, max_size=512, quality=88):
    path=Path(path);raw=path.read_bytes()
    if len(raw)<28 or raw[:4]!=b'glTF':raise ValueError('无效 GLB')
    magic,version,total=struct.unpack_from('<III',raw)
    if version!=2 or total!=len(raw):raise ValueError('GLB 长度或版本错误')
    chunks={};offset=12
    while offset<len(raw):
        length,kind=struct.unpack_from('<II',raw,offset);offset+=8
        if offset+length>len(raw):raise ValueError('GLB 数据截断')
        chunks[kind]=raw[offset:offset+length];offset+=length
    if 0x4e4f534a not in chunks or 0x004e4942 not in chunks:raise ValueError('GLB 缺少数据块')
    doc=json.loads(chunks[0x4e4f534a]);binary=chunks[0x004e4942]
    images=doc.get('images',[]);views=doc.get('bufferViews',[])
    replacements={};before_pixels=after_pixels=image_before=image_after=0
    for image in images:
        if 'uri' in image or 'bufferView' not in image:raise ValueError('仅支持内嵌 GLB 纹理')
        index=image['bufferView'];view=views[index];start=view.get('byteOffset',0);length=view['byteLength']
        if view.get('buffer',0)!=0 or start+length>len(binary):raise ValueError('纹理缓冲区越界')
        with Image.open(io.BytesIO(binary[start:start+length])) as source:
            source.load();before_pixels+=source.width*source.height
            # Alpha is retained as PNG; opaque scanned surfaces use JPEG, including normal/ORM maps.
            alpha='A' in source.getbands() or 'transparency' in source.info
            resized=source.convert('RGBA' if alpha else 'RGB')
            resized.thumbnail((max_size,max_size),Image.Resampling.LANCZOS)
            after_pixels+=resized.width*resized.height
            encoded=io.BytesIO()
            if alpha:resized.save(encoded,format='PNG',optimize=True)
            else:resized.save(encoded,format='JPEG',quality=quality,subsampling=0,optimize=True)
            candidate=encoded.getvalue()
            if max(source.size)<=max_size and len(candidate)>=length:
                replacements[index]=binary[start:start+length]
            else:
                image['mimeType']='image/png' if alpha else 'image/jpeg'
                replacements[index]=candidate
            image_before+=length;image_after+=len(replacements[index])
    result=bytearray()
    for index,view in enumerate(views):
        start=view.get('byteOffset',0);length=view['byteLength']
        if view.get('buffer',0)!=0 or start+length>len(binary):raise ValueError('GLB 缓冲区越界')
        payload=replacements.get(index,binary[start:start+length])
        result.extend(b'\0'*((-len(result))%4));view['byteOffset']=len(result);view['byteLength']=len(payload)
        result.extend(payload)
    doc['buffers']=[{'byteLength':len(result)}]
    js=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode('utf8');js+=b' '*((-len(js))%4)
    result.extend(b'\0'*((-len(result))%4))
    packed=struct.pack('<III',magic,2,28+len(js)+len(result))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(result),0x004e4942)+result
    # Validate all processing before replacing the serving file. Original textures remain downloadable locally.
    full=path.with_name(path.stem+'-full-'+hashlib.sha256(raw).hexdigest()[:12]+'.glb')
    if full.exists() and full.read_bytes()!=raw:raise ValueError('完整材质备份冲突')
    full.write_bytes(raw)
    temporary=path.with_suffix('.glb.tmp');temporary.write_bytes(packed);temporary.replace(path)
    return {'bytes_before':len(raw),'bytes_after':len(packed),'texture_bytes_before':image_before,
            'texture_bytes_after':image_after,'texture_max_size':max_size,'texture_jpeg_quality':quality,
            'texture_rgba_mip_estimate_before':round(before_pixels*4*4/3),
            'texture_rgba_mip_estimate_after':round(after_pixels*4*4/3),
            'geometry_codec':'draco' if 'KHR_draco_mesh_compression' in doc.get('extensionsRequired',[]) else 'none',
            'full_texture_file':full.name}
