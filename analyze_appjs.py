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

print('=== Duplicate function definitions ===')
duplicated = {k: v for k, v in func_map.items() if len(v) > 1}
for name, lnums in sorted(duplicated.items()):
    print('Func: ' + name + ', Count: ' + str(len(lnums)) + ', Lines: ' + str(lnums))

print()
print('=== Likely unused functions ===')
for name, lnums in sorted(func_map.items()):
    def_count = len(lnums)
    call_pattern = re.compile(r'\b' + re.escape(name) + r'\s*\(')
    all_calls = list(call_pattern.finditer(content))
    real_calls = 0
    for m in all_calls:
        line_num = content[:m.start()].count('\n') + 1
        if line_num not in lnums:
            real_calls += 1
    dot_call_pattern = re.compile(r'\.' + re.escape(name) + r'\s*\(')
    dot_calls = len(dot_call_pattern.findall(content))
    prop_pattern = re.compile(r':\s*' + re.escape(name) + r'\b')
    props = len(prop_pattern.findall(content))
    
    if real_calls == 0 and dot_calls == 0:
        print('Func: ' + name + ', Lines: ' + str(lnums) + ', propRefs: ' + str(props))

print()
print('=== Functions called only once ===')
for name, lnums in sorted(func_map.items()):
    def_count = len(lnums)
    call_pattern = re.compile(r'\b' + re.escape(name) + r'\s*\(')
    all_calls = list(call_pattern.finditer(content))
    real_calls = 0
    for m in all_calls:
        line_num = content[:m.start()].count('\n') + 1
        if line_num not in lnums:
            real_calls += 1
    dot_call_pattern = re.compile(r'\.' + re.escape(name) + r'\s*\(')
    dot_calls = len(dot_call_pattern.findall(content))
    
    if real_calls + dot_calls == 1 and def_count == 1:
        print('Func: ' + name + ', Lines: ' + str(lnums))
