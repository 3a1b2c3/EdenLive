import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'forge'))
from check_step3 import matches, validate_strategy, verdict
from gate_fixtures import HELD_INPUT_STRATEGY
from sync_parameters import sync
from _shared.state import state_errors, next_step
from test_state import progressed_state, reviewed_assessments


def test_playthrough_rejects_unearned_or_unstable_success():
    state = dict(state='WON', elapsed=2, terminalCount=1)
    assert verdict(state, 'WON', [{'type': 'parry'}], [{}], 180) is None
    for changed, interactions, inputs in [({'state':'RUNNING'},[{}],[{}]), ({'terminalCount':2},[{}],[{}]), ({'elapsed':181},[{}],[{}]), ({},[],[{}]), ({},[{}],[])]:
        assert verdict(dict(state, **changed), 'WON', interactions, inputs, 180)


def test_strategy_cannot_inject_page_code_or_skip_loss():
    plan=copy.deepcopy(HELD_INPUT_STRATEGY)
    validate_strategy(plan)
    bad=copy.deepcopy(plan);bad['scenarios'][0]['rules'][0]['action']={'type':'evaluate','code':'win()'}
    with pytest.raises(ValueError): validate_strategy(bad)
    with pytest.raises(ValueError): validate_strategy(dict(plan,scenarios=plan['scenarios'][:1]))
    assert matches({'actor':{'ready':True}}, {'actor.ready':True})
    with pytest.raises(ValueError): matches({}, {'unknown':True})


def test_parameter_sync_preserves_original_intent_and_detects_drift(tmp_path):
    source=tmp_path/'p.json';doc=tmp_path/'notes.md'
    source.write_text('{"window":0.3}');doc.write_text('Original design: window 0.2 seconds.\n')
    assert sync(source, doc);assert sync(source, doc, True)
    source.write_text('{"window":0.4}');assert not sync(source,doc,True)
    sync(source,doc);assert doc.read_text().startswith('Original design: window 0.2 seconds.')
    doc.write_text('<!-- current-parameters:end -->bad<!-- current-parameters:start -->')
    with pytest.raises(ValueError):sync(source,doc)


def new_state():
    state = progressed_state('done')
    state['revisions'] = [{'id':'combat-fix','request':'Fix cue timing','affected_stages':['scene','acceptance'],'status':'in_progress','loop_count':0,'evidence':[],'parameter_source':'parameters.json','regressions':['guard boundary','input win/loss/replay']}]
    return state


def test_active_revision_overrides_done_and_has_separate_budget():
    state=new_state();assert not state_errors(state)
    message,code=next_step(state);assert code==0 and 'combat-fix' in message and 'check_step3.py' in message
    state['revisions'][0]['loop_count']=3;assert next_step(state)[1]==3
    state['revisions'][0]['status']='passed';assert state_errors(state)
    state['revisions'][0]['evidence']=['new report']
    assert any('assessments' in error for error in state_errors(state))
    state['revisions'][0]['assessments']=reviewed_assessments('new report')
    assert not state_errors(state)
    assert 'complete' in next_step(state)[0]


def test_failed_or_unreviewed_experience_does_not_hide_behind_functional_pass():
    state=new_state();r=state['revisions'][0];r.update(status='passed',evidence=['report'])
    r['assessments']={k:{'status':'passed','evidence':['report']} for k in ('functional','experience','performance')}
    assert not state_errors(state)
    r['assessments']['experience']={'status':'not_evaluated','evidence':[],'reason':'not played'}
    assert state_errors(state)
    r['assessments']['experience']={'status':'passed','evidence':['visual review']}
    r['assessments']['performance']={'status':'not_evaluated','evidence':[],'reason':'no target GPU'}
    assert not state_errors(state)
