"""Browser behavior for DOM projection/resource UI and transient capture."""
import sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'forge'))
from check_step1 import serving, SOFTWARE_GL_ARGS
from check_step3 import capture_frozen, snapshot, install_capture_clock
from gate_fixtures import CUE_PAGE, fixture_run

@pytest.mark.slow
def test_projection_capacity_and_frozen_state(tmp_path, browser_dependencies):
    from playwright.sync_api import sync_playwright
    # The host page comes from a written fixture, not a checked-in example game: these
    # checks need a rendering page with a cue, not a playable prototype.
    with fixture_run('readability',CUE_PAGE,run_name='cue') as (runs_dir,run), \
            serving(runs_dir,runs_dir.relative_to(ROOT).as_posix()) as base, sync_playwright() as p:
        browser=p.chromium.launch(executable_path=browser_dependencies,headless=True,args=SOFTWARE_GL_ARGS)
        try:
            page=browser.new_page(viewport={'width':960,'height':640},device_scale_factor=2)
            install_capture_clock(page)
            page.goto(f"{base}/{run.relative_to(ROOT).as_posix()}/");page.wait_for_function('() => window.__gameTest')
            result=page.evaluate('''async () => {
              const {WorldAnchorLabel}=await import('/assets/user-interface/WorldAnchorLabel.js');
              const {SegmentedResourceView}=await import('/assets/user-interface/SegmentedResourceView.js');
              const {ResourcePool}=await import('/assets/gameplay/ResourcePool.js');
              const {PerspectiveCamera,Vector3}=await import('three');
              const c=document.createElement('div');c.style.cssText='position:absolute;left:37px;top:53px;width:400px;height:300px;border:3px solid black';document.body.append(c);
              const e=document.createElement('div');c.append(e);const label=new WorldAnchorLabel({element:e,container:c,height:0});
              const camera=new PerspectiveCamera(60,4/3,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
              const viewport={left:40,top:56,width:400,height:300};
              const shown=label.update({position:new Vector3(),camera,viewport});const center=[parseFloat(e.style.left),parseFloat(e.style.top)];
              const behind=label.update({position:new Vector3(0,0,6),camera,viewport});
              const occluded=label.update({position:new Vector3(),camera,viewport,occluded:true});
              viewport.width=200;viewport.height=150;camera.aspect=4/3;camera.updateProjectionMatrix();label.update({position:new Vector3(),camera,viewport});
              const resized=[parseFloat(e.style.left),parseFloat(e.style.top)];
              const pool=new ResourcePool({initial:0,max:3}), view=new SegmentedResourceView({container:c,segments:3});
              const values=[];for(const n of [0,1,3,0]){pool.set(n);view.update(pool);values.push([view.fill.style.width,view.track.getAttribute('aria-valuenow'),view.root.classList.contains('ready')]);pool.drainEvents();}
              view.dispose();label.dispose();c.remove();return {shown,center,behind,occluded,resized,values};
            }''')
            assert result['shown'] and not result['behind'] and not result['occluded']
            assert result['center']==[200,150] and result['resized']==[100,75]
            assert result['values'][0]==['0%','0',False]
            assert result['values'][2]==['100%','3',True] and result['values'][3]==['0%','0',False]
            page.keyboard.press('r')
            # Input raises the cue before RAF updates its label. Freeze only after
            # both are observable, without assuming a browser/rendering latency.
            page.wait_for_function('() => { const s = window.__gameTest.read(); return s.cue && s.labelVisible; }')
            frozen=capture_frozen(page,tmp_path/'cue.png')
            assert frozen['cue'] and frozen['labelVisible'] and (tmp_path/'cue.png').stat().st_size>1000
        finally:browser.close()
