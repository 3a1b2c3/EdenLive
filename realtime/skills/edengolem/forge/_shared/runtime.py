"""Shared browser configuration and passive runtime diagnostics. No gameplay writes."""
from _shared.diagnostics import diagnose

SOFTWARE_GL_ARGS = [
    '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
    '--enable-webgl', '--in-process-gpu',
]


def browser_args(hardware=False):
    # Scope proxy bypass to the local artifact; never rewrite process/global proxy settings.
    return ([] if hardware else SOFTWARE_GL_ARGS) + ['--proxy-bypass-list=localhost;127.0.0.1;[::1]']


def install_runtime_probe(page):
    page.add_init_script('''(() => {
      const samples = []; let last;
      const tick = now => {
        if (last !== undefined) { samples.push((now-last)/1000); if (samples.length > 240) samples.shift(); }
        last = now; requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__runtimeProbe = Object.freeze({ read: () => samples.slice() });
    })();''')


def runtime_report(page, capabilities=()):
    report = page.evaluate('''() => {
      const c = document.querySelector('canvas');
      const gl = c?.getContext('webgl2') || c?.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      const raw = (window.__runtimeProbe?.read() ?? []).sort((a,b) => a-b);
      const observed = window.__gameTest?.read?.() ?? {};
      const clock = observed.clock;
      const diagnostics = observed.diagnostics;
      return {
        renderer, viewport: {width: innerWidth, height: innerHeight, devicePixelRatio},
        rawFrames: {status: raw.length ? 'measured' : 'not_evaluated', sampleCount: raw.length,
          medianMs: raw.length ? raw[Math.floor(raw.length/2)]*1000 : null,
          p95Ms: raw.length ? raw[Math.min(raw.length-1, Math.floor(raw.length*.95))]*1000 : null},
        clock: clock ? {status: 'observed', ...clock,
          simulationToActiveRatio: clock.activeSeconds > 0 ? clock.simulatedSeconds/clock.activeSeconds : null,
          simulationToWallRatio: clock.wallSeconds > 0 ? clock.simulatedSeconds/clock.wallSeconds : null}
          : {status: 'not_evaluated', reason: 'game does not expose cumulative clock accounting'},
        diagnostics: diagnostics ?? null,
        resources: performance.getEntriesByType('resource').map(r => ({url:r.name, durationMs:r.duration})),
        imageReview: {status:'not_evaluated', reason:'capture does not establish that an image channel displayed it to a reviewer'},
        limitation: 'Passive RAF samples may differ from game updates. Cumulative clock values are game observations. Neither establishes target performance.'
      };
    }''')
    report['diagnostics'] = diagnose(report, capabilities)
    return report
