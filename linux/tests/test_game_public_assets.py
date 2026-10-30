import importlib.util
from pathlib import Path


def test_game_assets_are_staged_but_tests_research_and_credentials_are_not(tmp_path):
    script = Path(__file__).resolve().parents[1] / 'scripts' / 'stage-web.py'
    spec = importlib.util.spec_from_file_location('game_stage', script)
    stage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stage)
    source = tmp_path / 'source'
    expected = ['index.html', 'homepage/dist/index.html', 'village_game/index.html',
                'village_game/integration/loader.js', 'village_game/integration/workspace.css',
                'village_game/domain/life.js']
    private = ['village_game/integration/session.test.js', '.research/example.html',
               'village_game/.env', 'village_game/README.md', 'village_game/backend/secret.js']
    for name in expected + private:
        p = source / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('fixture', encoding='utf-8')
    target = tmp_path / 'public'
    stage.stage(source, target)
    assert all((target / name).is_file() for name in expected)
    assert not any((target / name).exists() for name in private)
