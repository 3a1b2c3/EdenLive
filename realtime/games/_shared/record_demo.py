"""Record a proxy recording of a game played by its demo autopilot (games/<slug>/demo.json).

Writes <out>/<slug>/{recording.mp4, cover.png, first-frame.png, prompts.json, prompts.txt} in the
layout of examples/samples/, plus <out>/manifest.csv, so the offline pipeline can run on it:

    python record_demo.py --out ../../../outputs/game_demos jade-duel sunstone-pass ...
    python -m edenlive.scripts.infer --config edenlive/configs/wan22_5b_720p_few_step.yaml \
        data.dataset.params.path=<out>/manifest.csv data.dataset.params.root=<out>

The scene canvas only (no HUD) is captured at 1280x704, 24 fps, on the same virtual 60 Hz clock the
streaming host uses. 477 frames = 9 + 39 x 12, i.e. 39 four-step chunks after the opening chunk.
"""
import argparse, csv, json, mimetypes, shutil, subprocess, threading, base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from playwright.sync_api import sync_playwright

GAMES = Path(__file__).resolve().parents[1]
W, H, FPS, FRAMES = 1280, 704, 24, 477
VCLOCK = """(()=>{let now=0,q=new Map(),h=1,tick=0;
window.requestAnimationFrame=cb=>{const i=h++;q.set(i,cb);return i};window.cancelAnimationFrame=i=>q.delete(i);performance.now=()=>now;
function run(){const d=q;q=new Map();for(const c of d.values()){try{c(now)}catch(e){console.error(e.stack||e)}}}
window.__vstep=n=>{for(let i=0;i<n;i++){tick++;now=tick*1000/60;run()}return tick};
setTimeout(function r(){if(window.__gameTest){run();}else setTimeout(r,20)},50);})();"""
BG = ('mp', 'move', 'player.moved')


def serve(slug):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            rel = unquote(urlsplit(self.path).path).lstrip('/')
            if rel.startswith('assets/'): rel = f'{slug}/{rel}'
            p = GAMES / 'node_modules/three/build/three.module.js' if rel == 'vendor/three.module.js' else (GAMES / rel).resolve()
            if rel == '__vclock.js': body, ct = VCLOCK.encode(), 'text/javascript'
            elif p.is_file() and p.is_relative_to(GAMES):
                body = p.read_bytes(); ct = 'text/javascript' if p.suffix in ('.js', '.mjs') else mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
                if rel == f'{slug}/index.html':
                    body = body.decode().replace('<head>', '<head><script src="/__vclock.js"></script><script src="/_shared/autopilot.js"></script>', 1).encode()
            else:
                self.send_response(404); self.end_headers(); return
            self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    srv = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def build_prompts(entry, events, duration_ms):
    prompts = entry['event_prompts']
    step = 2500
    segs = []
    for start in range(0, duration_ms, step):
        end = min(duration_ms, start + step)
        texts = []
        for t, typ in events:
            if start <= t < end and typ in prompts and typ not in ('player.moved', 'round.won', 'round.lost') and prompts[typ] not in texts:
                texts.append(prompts[typ])
        if not texts:
            texts = [prompts['player.moved']]
        segs.append({'startMs': start, 'endMs': end, 'text': ' '.join(texts[:3])})
    for t, typ in events:
        if typ in ('round.won', 'round.lost'):
            segs[-1 if t >= duration_ms else min(len(segs) - 1, t // step)]['text'] += ' ' + prompts[typ]
    return segs


def record(browser, slug, out):
    entry = next(g for g in json.loads((GAMES / 'registry.json').read_text())['games'] if g['slug'] == slug)
    srv = serve(slug)
    pg = browser.new_page(viewport={'width': W, 'height': H})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/{slug}/index.html')
    pg.wait_for_function('window.__gameTest', timeout=30000)
    pg.add_style_tag(content='.eh,.gbui{display:none!important}')
    d = out / slug; d.mkdir(parents=True, exist_ok=True)
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-',
                           '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', str(d / 'recording.mp4')], stdin=subprocess.PIPE)
    seen, events, last = set(), [], None
    grab = "n=>{window.__vstep(n);return document.querySelector('#app canvas').toDataURL('image/jpeg',.95)}"
    for k in range(FRAMES):
        target = round(k * 60 / FPS)
        data = pg.evaluate(grab, 2 if k == 0 else target - last)  # step and read in one task: the GL buffer is only valid right after render
        last = 2 if k == 0 else target
        ff.stdin.write(base64.b64decode(data.split(',')[1]))
        for e in pg.evaluate('window.__gameTest.read().events'):
            if e['id'] not in seen:
                seen.add(e['id']); events.append((round(k * 1000 / FPS), e['type']))
    ff.stdin.close(); ff.wait()
    state = pg.evaluate('(()=>{const s=window.__gameTest.read();return {state:s.state,reason:s.outcomeReason,elapsed:s.elapsed}})()')
    srv.shutdown(); pg.close()
    duration_ms = round(FRAMES * 1000 / FPS)
    static = 'Cinematic photorealism. ' + entry['prompt']
    segs = build_prompts(entry, events, duration_ms)
    (d / 'prompts.json').write_text(json.dumps({'durationMs': duration_ms, 'staticPrompt': static, 'dynamicPrompts': segs}, indent=2))
    (d / 'prompts.txt').write_text(f"Sample: {entry['title']} ({slug})\nDuration: {duration_ms / 1000}s ({duration_ms} ms)\n\nSTATIC PROMPT\n{static}\n\nDYNAMIC PROMPTS\n"
                                   + ''.join(f"[{s['startMs']}-{s['endMs']} ms] {s['text']}\n" for s in segs))
    shutil.copy(GAMES / slug / 'cover.png', d / 'cover.png'); shutil.copy(GAMES / slug / 'first-frame.png', d / 'first-frame.png')
    print(slug, state, 'errors', errors[:2], flush=True)
    return {'id': slug, 'prompt': static, 'proxy_video': f'{slug}/recording.mp4', 'first_frame': f'{slug}/cover.png'}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); ap.add_argument('slugs', nargs='+')
    a = ap.parse_args(); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        for s in a.slugs: rows.append(record(b, s, out))
        b.close()
    with open(out / 'manifest.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, ['id', 'prompt', 'proxy_video', 'first_frame']); w.writeheader(); w.writerows(rows)
