import re

with open('app.js', 'r', encoding='utf-8-sig') as f:
    content = f.read()

patterns = [
    r'getCurrentUserName:\s*\(\)\s*=>\s*currentUserName',
    r'getCurrentSpaceId:\s*\(\)\s*=>\s*currentSpaceId',
    r'getInfoPanel:\s*\(\)\s*=>\s*infoPanel',
    r'getSpaces:\s*\(\)\s*=>\s*spaces',
    r'getCurrentSpace:\s*\(\)\s*=>\s*getCurrentSpace\(\)',
    r'saveSpacesToStorage,',
    r'sync2DSpaceStateTo3D,',
    r'escapeHtml,',
    r'showToast,',
]

for p in patterns:
    matches = list(re.finditer(p, content))
    if len(matches) > 1:
        print('Pattern repeats ' + str(len(matches)) + ' times: ' + p[:60])
