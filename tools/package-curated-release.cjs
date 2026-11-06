const fs=require('node:fs'),z=require('node:zlib'),crypto=require('node:crypto');
const dir='tmp/curated-release-20261105';
const template=fs.readFileSync('tools/curated-release-template.py','utf8');
const packed=z.deflateSync(fs.readFileSync(dir+'/manifest.json')).toString('base64');
const result=template.replace('MANIFEST = None  # BUILD_PAYLOAD',`MANIFEST=json.loads(zlib.decompress(base64.b64decode('${packed}')))`);
const file=dir+'/deploy-curated-20261105.py';fs.writeFileSync(file,result);
console.log(JSON.stringify({file,bytes:Buffer.byteLength(result),sha256:crypto.createHash('sha256').update(result).digest('hex')}));
