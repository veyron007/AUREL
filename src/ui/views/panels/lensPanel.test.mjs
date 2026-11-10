import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import LensPanelBody from './LensPanelBody.vue';
import { panelWithBody } from '../../../testSupport/panelBody.mjs';

const LensPanel = panelWithBody('lens-panel', LensPanelBody);
import { useLensStore } from '../../stores/lens.js';
import { normalizeLensSelection, buildLensEvidence } from '../../lensPresentation.js';
function fixture(t) {
 document.body.replaceChildren();const pinia=createPinia();const store=useLensStore(pinia);const app=createApp(LensPanel).use(pinia);app.mount(document.body.appendChild(document.createElement('div')));t.after(()=>app.unmount());return store;
}
const view=()=>({selection:normalizeLensSelection({id:'d',name:'देहरादून',lat:30.3258,lon:78.0438}),evidence:[],status:'ready',busy:false,error:null,feedback:null,note:''});
test('empty Lens offers existing current-view action with clear guidance',async t=>{
 const store=fixture(t);const calls=[];store.connect({inspectCurrentView:()=>calls.push('inspect')});await nextTick();assert.match(document.querySelector('.lens-empty').textContent,/Search for a place/);document.querySelector('#lens-inspect-view').click();assert.deepEqual(calls,['inspect']);
});
test('source quality is unknown and layer counts never appear as local facts',async t=>{
 const store=fixture(t);const state=view();state.evidence=buildLensEvidence({selection:state.selection,mapSource:{id:'map',label:'Overview'},layers:[{id:'feed',enabled:true,stats:{count:48197,source:'Feed'}}]});store.publish(state);await nextTick();document.querySelector('#lens-tab-evidence').click();await nextTick();assert.match(document.querySelector('#lens-tabpanel-evidence').textContent,/Unknown/);assert.match(document.querySelector('.lens-feed-status').textContent,/whole-layer states/);assert.ok(!document.querySelector('#lens-panel').textContent.includes('48197'));assert.ok(document.querySelector('.lens-feed-status table caption'));
});
test('tabs support arrow keys and retain owner note while switching tabs',async t=>{
 const store=fixture(t);const state=view();state.note='Meet near the clock tower';store.publish(state);const calls=[];store.connect({setNote:value=>calls.push(value),addNote:()=>calls.push('add')});await nextTick();const tab=document.querySelector('#lens-tab-overview');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));await nextTick();assert.equal(document.activeElement.id,'lens-tab-notes');assert.equal(document.querySelector('#lens-note').value,state.note);const textarea=document.querySelector('#lens-note');textarea.value='Updated note';textarea.dispatchEvent(new Event('input',{bubbles:true}));assert.deepEqual(calls,['Updated note']);document.querySelector('#lens-add-note').click();assert.deepEqual(calls,['Updated note','add']);
});
test('selection names are escaped and actions delegate through the store',async t=>{
 const store=fixture(t);const state=view();state.selection.name='<img src=x onerror=alert(1)>';store.publish(state);const calls=[];store.connect({savePlace:()=>calls.push('save'),focus:()=>calls.push('focus'),openWorkspace:id=>calls.push(id)});await nextTick();assert.equal(document.querySelector('.lens-identity img'),null);assert.match(document.querySelector('.lens-identity h2').textContent,/<img/);document.querySelector('#lens-save-place').click();assert.deepEqual(calls,['save']);
});
