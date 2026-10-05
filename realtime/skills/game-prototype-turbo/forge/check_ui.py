"""Optional isolated UI fixture review; acceptance owns integrated input proof."""
from urllib.parse import quote, urlsplit
from _shared.paths import resolve_inside

def preview(root, run, base_url, output=None):
    """Render only presentation fixtures; block scripts outside the UI closure."""
    from playwright.sync_api import sync_playwright
    from check_step1 import find_chromium
    from _shared.runtime import browser_args
    errors, frames, image_error = [], [], None
    prefix = run.relative_to(root).as_posix()
    ui_path = resolve_inside(root, run / 'ui/preview.html', 'preview')
    if not ui_path.is_file():
        raise ValueError('provide ui/preview.html with window.__uiPreview; use forge/ui.py or an equivalent isolated view')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=find_chromium(), args=browser_args(False))
        try:
            with browser.new_context(service_workers='block') as context:
                def route_request(route):
                    url = urlsplit(route.request.url)
                    local = url.netloc == urlsplit(base_url).netloc and url.scheme == 'http'
                    ui_script = url.path.startswith(f'/{prefix}/ui/') or url.path.startswith('/assets/user-interface/GameUi')
                    if local and (route.request.resource_type != 'script' or ui_script):
                        route.continue_()
                    elif url.scheme in ('data', 'blob') and route.request.resource_type == 'image':
                        route.continue_()
                    else:
                        errors.append(f'preview requested non-UI runtime: {route.request.url}')
                        route.abort()
                context.route('**/*', route_request)
                page = context.new_page(); page.set_default_timeout(5000)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                page.on('requestfailed', lambda r: errors.append(f'{r.url}: {r.failure}'))
                page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 else None)
                page.goto(f'{base_url.rstrip("/")}/{quote(prefix, safe="/")}/ui/preview.html', wait_until='load')
                page.wait_for_function('window.__uiPreview?.cases?.length > 0')
                cases = page.evaluate('window.__uiPreview.cases.map(c => c.name)')
                for width, height in ((960, 640),):
                    page.set_viewport_size({'width': width, 'height': height})
                    for index, name in enumerate(cases):
                        page.evaluate('i => window.__uiPreview.show(i)', index)
                        page.evaluate('() => document.fonts.ready')
                        layout = page.evaluate('''() => {
                          const selectors = window.__uiPreview.selectors || {};
                          const roots = [...document.querySelectorAll(selectors.roots || '.gbui')];
                          const within = el => roots.some(root => root === el || root.contains(el));
                          const components = [...document.querySelectorAll(selectors.components || '[data-ui-id],.gbui__brand,.gbui__panel,.gbui__card,.gbui__metric,.gbui__meter,.gbui__notice,.gbui__controls,.gbui__button,.gbui__dialog,.gbui__actions,.gbui__slot,.gbui__banner,.gbui__tracker')].filter(within);
                          const visible = components.filter(el => el.getClientRects().length);
                          const outside = visible.filter(el => {const r=el.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > innerWidth+1 || r.bottom > innerHeight+1 || el.scrollWidth > el.clientWidth+1;}).map(el=>el.dataset.uiId || el.className);
                          const passiveSelector = selectors.passive ?? '.gbui__brand,.gbui__metric,.gbui__meter,.gbui__panel,.gbui__notice,.gbui__controls';
                          const passive = passiveSelector ? visible.filter(el => el.matches(passiveSelector) && !el.closest('.gbui__dialog') && getComputedStyle(el).pointerEvents !== 'none').map(el=>el.dataset.uiId || el.className) : [];
                          const docks = [...document.querySelectorAll('.gbui__dock')];
                          const overlaps = docks.flatMap((a,i) => docks.slice(i+1).filter(b=>{if (!a.childElementCount || !b.childElementCount) return false; const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)>Math.max(x.left,y.left) && Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top);}).map(b=>[a.className,b.className]));
                          return {roots:roots.length, visible:visible.length, outside, passive, overlaps};
                        }''')
                        if not layout['roots'] or layout['outside'] or layout['passive'] or layout['overlaps']:
                            errors.append(f'{name} {width}x{height}: {layout}')
                        action_ids = []
                        create_mode = page.evaluate('window.__uiPreview.mode') == 'create'
                        for button in page.locator('button:visible:enabled').all():
                            if not button.evaluate("el => [...document.querySelectorAll(window.__uiPreview.selectors?.roots || '.gbui')].some(root => root === el || root.contains(el))"):
                                continue
                            button.focus()
                            if not button.evaluate('el => el === document.activeElement'):
                                errors.append('UI button cannot receive keyboard focus')
                            if create_mode:
                                action_ids.append(button.get_attribute('data-ui-action'))
                                button.press('Enter')
                        if create_mode:
                            if page.evaluate('window.__uiPreview.actions') != action_ids:
                                errors.append(f'{name}: button-to-callback mapping failed')
                        screenshot = None
                        if output and image_error is None:
                            screenshot = resolve_inside(root, output / f'ui-{width}-{index}.png', 'screenshot')
                            try:
                                page.screenshot(path=str(screenshot))
                            except Exception as exc:
                                image_error = f'{type(exc).__name__}: {exc}'
                                screenshot = None
                        frames.append({'case': name, 'viewport': [width, height], 'layout': layout,
                                       'stub_actions': action_ids, 'screenshot': screenshot.relative_to(root).as_posix() if screenshot else None})
        finally:
            browser.close()
    return {'status': 'failed' if errors else 'passed', 'frames': frames, 'errors': errors,
            'images': {'status': 'not_evaluated' if image_error or not output else 'captured', 'reason': image_error},
            'scope': 'UI fixtures, local resources, viewport bounds, passive input, keyboard focus and stub callbacks; no game simulation'}



def inspect_layout(page):
    """Inspect the integrated interface at its current viewport; no state writes."""
    return page.evaluate('''() => {
      const roots=[...document.querySelectorAll('[data-game-ui],.gbui,#hud')];
      const visible=el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const elements=[...new Set(roots.flatMap(root => [root,...root.querySelectorAll('button,input,select,[role="button"],[data-ui-id]')]))].filter(visible);
      const outside=elements.filter(el => { const r=el.getBoundingClientRect();
        return r.left < -1 || r.top < -1 || r.right > innerWidth+1 || r.bottom > innerHeight+1 || el.scrollWidth > el.clientWidth+1;
      }).map(el => el.id || el.dataset.uiId || el.tagName);
      return {roots:roots.length, visible:elements.length, outside};
    }''')


def integrated_review(page, *, required=True):
    """Bounds/focus smoke check at the desktop play viewport; phone layouts are out of scope."""
    if not required:
        return {'status':'not_applicable','reason':'brief explicitly omits interface design'}
    size = page.viewport_size
    samples, errors = [], []
    page.evaluate('() => document.fonts.ready')
    layout = inspect_layout(page)
    samples.append({'viewport': size, **layout})
    if not layout['roots'] or not layout['visible'] or layout['outside']:
        errors.append(f'UI missing or clipped at {size}: {layout}')
    for control in page.locator('[data-game-ui] button:visible:enabled,.gbui button:visible:enabled,#hud button:visible:enabled').all():
        control.focus()
        if not control.evaluate('el => el === document.activeElement'):
            errors.append('UI button cannot receive keyboard focus')
    return {'status':'failed' if errors else 'passed','samples':samples,'errors':errors,
            'scope':'integrated viewport bounds and focus; inspect screenshots for meaning and readability'}
