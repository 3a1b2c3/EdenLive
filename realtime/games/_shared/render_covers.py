"""Render photoreal covers from each game's first-frame.png with the FLUX c2f worker pipeline.

Run on a GPU host (e.g. inside the pcl-infer-video pod):
    python render_covers.py [slug ...]
Reads cover_prompt from registry.json; writes cover.png, poster.png and artwork.json.
"""
import hashlib, json, os, sys, time
from pathlib import Path

GAMES = Path(__file__).resolve().parents[1]
REALTIME = GAMES.parent
sys.path.insert(0, str(REALTIME / 'integrations_v2'))
os.environ.setdefault('EDEN_MODEL_ROOT', os.environ.get('MODEL_ROOT', str(REALTIME.parent / 'models' / 'EdenLive')))
os.environ.setdefault('HF_HUB_OFFLINE', '1')
from eden.apps.workbench.flux_worker import FluxRenderer, WIDTH, HEIGHT, STEPS, GUIDANCE  # noqa: E402

SLUGS = ['ember-den', 'frostworks', 'neon-blockade', 'sunstone-pass', 'tidal-generator', 'iron-colossus', 'jade-duel', 'warehouse-sokoban']
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    slugs = sys.argv[1:] or SLUGS
    entries = {g['slug']: g for g in json.loads((GAMES / 'registry.json').read_text())['games']}
    renderer = FluxRenderer(offload=False)
    for i, slug in enumerate(slugs):
        d = GAMES / slug
        seed = 20261100 + i
        caption = entries[slug]['cover_prompt']
        info = renderer.render(d / 'first-frame.png', caption, seed, d / 'cover.png')
        (d / 'poster.png').write_bytes((d / 'cover.png').read_bytes())
        json.dump({'caption': caption, 'seed': seed, 'input': 'first-frame.png', 'output': 'cover.png', 'width': WIDTH, 'height': HEIGHT,
                   'steps': STEPS, 'guidance': GUIDANCE, 'pipeline': 'FLUX.2 Klein base with coarse-to-fine LoRA',
                   'generation': {'seconds': info['seconds'], 'peak_gb': info['peak_gb']},
                   'input_sha256': sha(d / 'first-frame.png'), 'output_sha256': sha(d / 'cover.png')},
                  open(d / 'artwork.json', 'w'), indent=2)
        print(slug, info, flush=True)


if __name__ == '__main__':
    main()
