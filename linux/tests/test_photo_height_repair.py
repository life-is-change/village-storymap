"""Keep Worker startup from racing its network attachment during repair."""
import ast
import json
from pathlib import Path


def test_repair_attaches_egress_before_starting_worker():
    tree = ast.parse((Path(__file__).parents[2] / 'tools/photo-height-worker-repair.py').read_text())
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'recreate')
    commands = []
    scope = {'run': commands.append, 'read': lambda _: json.dumps([{'NetworkSettings': {'Networks': {
        'village-platform_facade-internal': {}}}}]).encode(), 'json': json,
        'compose': '/checked/compose.json', 'container': 'village-platform-facade-worker-1'}
    exec(compile(ast.Module(body=[function], type_ignores=[]), '<recreate>', 'exec'), scope)
    scope['recreate']()
    assert 'up' in commands[0] and '--no-start' in commands[0] and '--no-deps' in commands[0]
    assert commands[1] == ['docker', 'network', 'connect', '--alias', 'facade-worker',
                            'village-platform_egress', 'village-platform-facade-worker-1']
    assert commands[2] == ['docker', 'start', 'village-platform-facade-worker-1']
