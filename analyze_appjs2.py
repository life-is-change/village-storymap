import re

with open('app.js', 'r', encoding='utf-8-sig') as f:
    content = f.read()
    lines = content.splitlines()

func_pattern = re.compile(r'^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(')
func_map = {}
for i, line in enumerate(lines, 1):
    m = func_pattern.search(line)
    if m:
        name = m.group(1)
        func_map.setdefault(name, []).append(i)

print('=== Likely unused functions (no call, no property ref, no export) ===')
for name, lnums in sorted(func_map.items()):
    def_lines = set(lnums)
    
    # 找出所有包含该函数名的位置（按行号）
    name_pattern = re.compile(r'\b' + re.escape(name) + r'\b')
    all_matches = list(name_pattern.finditer(content))
    
    other_lines = []
    for m in all_matches:
        line_num = content[:m.start()].count('\n') + 1
        if line_num not in def_lines:
            other_lines.append(line_num)
    
    if len(other_lines) == 0:
        print('UNUSED: ' + name + ' at lines ' + str(lnums))
    elif len(other_lines) == 1:
        print('ONCE: ' + name + ' at lines ' + str(lnums) + ', other at ' + str(other_lines))

print()
print('=== Duplicate definitions ===')
for name, lnums in sorted(func_map.items()):
    if len(lnums) > 1:
        print('DUP: ' + name + ' at lines ' + str(lnums))
