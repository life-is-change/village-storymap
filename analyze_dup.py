import re

with open('app.js', 'r', encoding='utf-8-sig') as f:
    content = f.read()
    lines = content.splitlines()

# 查找大段重复代码（长度 >= 40字符的重复行或行块）
# 这里检测完全相同的连续2行或以上的代码块
print('=== Duplicate code blocks (>= 2 consecutive lines, stripped) ===')
block_size = 2
seen_blocks = {}
for i in range(len(lines) - block_size + 1):
    block = tuple(line.strip() for line in lines[i:i+block_size])
    if all(len(b) > 20 for b in block):
        seen_blocks.setdefault(block, []).append(i + 1)

for block, lnums in seen_blocks.items():
    if len(lnums) > 1:
        print('Lines ' + str(lnums) + ':')
        for b in block:
            print('  ' + b[:120])
        print()
