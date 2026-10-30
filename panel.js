'use strict';
const $=id=>document.getElementById(id),C=ReplyGuard;
const names={checking:'正在核验',skipped:'未命中',matched:'规则命中',not_matched:'未命中',pending_action:'正在提交屏蔽',blocked:'已确认屏蔽',undone:'已撤销',undo_unknown:'撤销未确认',unknown:'结果未知，请到 X 核查',error:'核验中断'};
let config=C.settings(),records=[],run=null,saving=false,loadVersion=0;
const criterionButtons=[...document.querySelectorAll('[data-criterion]')];
async function call(op,data={}){const r=await chrome.runtime.sendMessage({op,...data});if(!r?.ok)throw Error(r?.error||'扩展未响应');return r.result;}
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
function el(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function renderConfig(){
 for(const b of criterionButtons)b.setAttribute('aria-pressed',String(config.criteria.includes(b.dataset.criterion)));
 const count={2:'两',3:'三',4:'四'}[config.minMatches];
 $('ruleHint').textContent=`已选条件中命中${count}项，即执行${config.action==='block'?'屏蔽':config.action==='hide'?'折叠':'记录'}。`;
 $('action').value=config.action;
}
function renderStatus(){
 $('status').classList.toggle('running',!!run?.enabled);$('statusText').textContent=run?.enabled?'运行中':'已暂停';
 $('account').textContent=run?.owner?'@'+run.owner:'尚未连接';
 const confirmed=Math.max(0,Number(run?.confirmed)||0),target=Math.max(1,Number(run?.target)||1000);
 for(const [id,value] of Object.entries({confirmed,target,checked:run?.checked||0,queued:run?.queue?.length||0,seen:run?.seen?.length||0}))$(id).textContent=Number(value).toLocaleString('en-US');
 $('progress').max=target;$('progress').value=Math.min(confirmed,target);$('percentage').textContent=(Math.min(100,confirmed/target*100)).toLocaleString('en-US',{maximumFractionDigits:1})+'%';
 $('detail').textContent=run?.message||'打开 X 页面后启动检查。';
 $('start').disabled=saving||!!run?.enabled;$('stop').disabled=saving||!run?.enabled;
}
function renderRecords(){
 const root=$('records');root.replaceChildren();const items=records.filter(r=>!run?.owner||r.owner===run.owner).slice(0,30);
 if(!items.length){root.append(el('p','暂无记录。'));return;}
 for(const r of items){
  const card=el('article');card.className='record';const link=el('a','@'+r.handle);link.href='https://x.com/'+encodeURIComponent(r.handle);link.target='_blank';link.rel='noopener';card.append(link,el('b',' · '+(names[r.status]||r.status)));
  card.append(el('p',new Date(r.time).toLocaleString('zh-CN')));
  if(r.decision?.matchedCriteria?.length)card.append(el('p','命中：'+r.decision.matchedCriteria.join(' + ')));
  if(r.profile)card.append(el('p',`粉丝 ${r.profile.followers??'未知'} · ${r.profile.location||'地区未知'} · ${r.profile.client||'来源未知'}`));
  if(r.decision){
   if(r.decision.total)card.append(el('p',`明确辱骂 ${r.decision.hits} / 本人回复 ${r.decision.total}`));
   if(r.decision.reasons?.length)card.append(el('p',r.decision.reasons.join('；')));
   if(r.decision.evidence?.length){const details=el('details');details.append(el('summary','查看命中证据'));
    for(const p of r.decision.evidence){const box=el('div');box.className='evidence';box.append(el('p',p.text),el('p',(p.tags||[]).join('、')));if(/^https:\/\/x\.com\/\w+\/status\/\d+$/.test(p.url||'')){const a=el('a','查看原帖');a.href=p.url;a.target='_blank';a.rel='noopener';box.append(a);}details.append(box);}card.append(details);
   }
  }
  if(r.error)card.append(el('p',r.error));
  const white=el('button','加入白名单');white.onclick=()=>perform(async()=>{await call('allow',{handle:r.handle});notice('已加入白名单，检查已暂停。');await refresh(true);});card.append(white);
  if(r.status==='blocked'){const undo=el('button','撤销屏蔽');undo.onclick=()=>perform(async()=>{undo.disabled=true;try{await call('undo',{key:r.key});notice('已撤销并加入白名单。');}finally{undo.disabled=false;}});card.append(undo);}root.append(card);
 }
}
async function refresh(reloadConfig=false){
 const version=++loadVersion;const [data,current]=await Promise.all([chrome.storage.local.get(['config','records']),call('run')]);if(version!==loadVersion)return;
 records=data.records||[];run=current;
 if(reloadConfig){config=C.settings(data.config);renderConfig();if($('allowlistSection').hidden)$('allowlist').value=config.allowlist.join('\n');}
 renderStatus();if(!$('recordsSection').hidden)renderRecords();
}
async function perform(fn){try{await fn();await refresh();}catch(e){notice(e.message);}}
async function saveConfig(next){
 if(saving)return;saving=true;for(const b of criterionButtons)b.disabled=true;$('action').disabled=true;renderStatus();
 try{const validated=C.settings(next);await call('save',{config:validated});config=validated;renderConfig();notice('已保存，检查已暂停。点击启动后使用新规则。');}
 finally{saving=false;for(const b of criterionButtons)b.disabled=false;$('action').disabled=false;renderStatus();}
}
for(const b of criterionButtons)b.onclick=()=>perform(async()=>{
 const key=b.dataset.criterion;const criteria=config.criteria.includes(key)?config.criteria.filter(k=>k!==key):[...config.criteria,key];
 if(criteria.length<2){notice('至少保留两个条件。');return;}
 await saveConfig({...config,policy:'two_of_four',criteria,minMatches:2});
});
$('action').onchange=()=>perform(async()=>{try{await saveConfig({...config,action:$('action').value});}catch(e){renderConfig();throw e;}});
$('start').onclick=()=>perform(async()=>{await call('start');notice('自动检查已启动。');});
$('stop').onclick=()=>perform(async()=>{await call('stop');notice('已暂停后续动作，已提交的请求仍会核验结果。');});
function drawer(id){const open=$(id).hidden;for(const other of ['allowlistSection','recordsSection'])$(other).hidden=true;$(id).hidden=!open;if(open){if(id==='allowlistSection')$('allowlist').value=config.allowlist.join('\n');else renderRecords();$(id).scrollIntoView?.({behavior:'smooth',block:'start'});}}
$('showAllowlist').onclick=()=>drawer('allowlistSection');$('showRecords').onclick=()=>drawer('recordsSection');
for(const b of document.querySelectorAll('.close-drawer'))b.onclick=()=>{b.closest('.drawer').hidden=true;};
$('saveAllowlist').onclick=()=>perform(()=>saveConfig({...config,allowlist:$('allowlist').value.split(/[\s,，]+/).filter(Boolean).map(h=>h.replace(/^@/,''))}));
$('inspect').onclick=()=>perform(async()=>{await call('inspect',{handle:$('handle').value.trim().replace(/^@/,'')});notice('已加入核验队列，重复账号自动去重。');});
$('reload').onclick=()=>perform(async()=>{await call('stop');chrome.runtime.reload();});
$('export').onclick=()=>perform(async()=>{const data=await chrome.storage.local.get(['records','config']);const current=await call('run');const audit={...data,run:current,exportedAt:new Date().toISOString()};const url=URL.createObjectURL(new Blob([JSON.stringify(audit,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='x-guard-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);notice('记录已导出。');});
chrome.storage.onChanged.addListener((changes,area)=>{void refresh(area==='local'&&!!changes.config).catch(e=>notice(e.message));});
void refresh(true).catch(e=>notice(e.message));
