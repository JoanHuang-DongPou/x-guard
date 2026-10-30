importScripts('core.js','state.js');
const C=ReplyGuard,S=ReplyGuardState;
let busy=false,lock=Promise.resolve();
const serial=fn=>{const task=lock.then(fn);lock=task.catch(()=>{});return task;};
const getRun=async()=>(await chrome.storage.session.get('run')).run;
const saveRun=run=>chrome.storage.session.set({run});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function check(token){const run=await getRun();if(!run?.enabled||run.token!==token)throw Error('任务已暂停');return run;}
async function patchRun(token,patch){return serial(async()=>{const r=await getRun();if(r?.token!==token)throw Error('任务已变更');await saveRun({...r,...patch});});}
async function record(item){return serial(async()=>{
 const {records=[]}=await chrome.storage.local.get('records');
 if(item.decision)item={...item,decision:{...item.decision,evidence:item.decision.evidence.slice(0,5).map(p=>({...p,text:p.text.slice(0,600)}))}};
 const all=[item,...records.filter(r=>r.key!==item.key)];let ordinary=0;
 await chrome.storage.local.set({records:all.filter(r=>['blocked','pending_action','unknown','undo_unknown','undone'].includes(r.status)||ordinary++<2000)});
});}
async function pause(reason){return serial(async()=>{const run=await getRun();if(run)await saveRun({...run,enabled:false,message:reason});});}
async function recover(run){
 const {records=[]}=await chrome.storage.local.get('records');
 for(const item of records.filter(r=>r.owner===run.owner&&r.handle===run.current&&['checking','pending_action'].includes(r.status)))await record({...item,status:item.status==='pending_action'?'unknown':'error',error:'后台执行中断，请到 X 核查；未自动重试'});
 if(run.workerTab)await chrome.tabs.remove(run.workerTab).catch(()=>{});
 await patchRun(run.token,{enabled:false,current:null,workerTab:null,message:'上次执行中断，记录已标记；请检查后重新启动'});
}
async function send(tabId,message){const response=await chrome.tabs.sendMessage(tabId,message);if(!response?.ok)throw Error(response?.error||'页面未响应');return response.result;}
async function visit(tabId,url,kind,handle,token){
 await check(token);await chrome.tabs.update(tabId,{url});
 for(let i=0;i<40;i++){
  await check(token);const tab=await chrome.tabs.get(tabId);
  if(tab.status==='complete'&&tab.url===url){
   let result;
   try{result=await send(tabId,{op:'snapshot',kind,handle});}catch(e){if(/Receiving end does not exist|Could not establish connection/.test(e.message)){await sleep(500);continue;}throw e;}
   const run=await check(token);if(result.owner!==run.owner)throw Error('X 登录账号变更，已暂停');return result;
  }await sleep(500);
 }throw Error('X 页面未按时加载');
}
async function task(handle,run){
 const key=crypto.randomUUID(),time=Date.now(),base={key,time,owner:run.owner,handle,policy:run.policy,ruleKey:run.ruleKey,status:'checking'};
 let workerTab;await record(base);
 try{
  await check(run.token);const tab=await chrome.tabs.create({url:'https://x.com/'+handle,active:false});workerTab=tab.id;
  await patchRun(run.token,{workerTab});
  let snap=await visit(workerTab,'https://x.com/'+handle,'profile',handle,run.token);
  let profile=snap.profile;const config=C.settings((await chrome.storage.local.get('config')).config);
  if(profile.following!==false||profile.blocked!==false||config.allowlist.includes(handle)){
   await record({...base,profile,status:'skipped',decision:C.decide(profile,[],config)});return;
  }
  const about=await visit(workerTab,`https://x.com/${handle}/about`,'about',handle,run.token);profile={...profile,...about.about};
  const pre=C.decide(profile,[],config);
  let posts=[];
  // Two observable metadata hits are sufficient under the user's two-of-four rule.
  if(!pre.match){
  if(!pre.needsReplies){await record({...base,profile,status:'skipped',decision:pre});return;}
  const query=`from:${handle} filter:replies -filter:retweets`;
  const replies=await visit(workerTab,'https://x.com/search?q='+encodeURIComponent(query)+'&src=typed_query&f=live','replies',handle,run.token);
  const samples=new Map();const add=posts=>{for(const p of posts)if(p.author===handle&&!samples.has(p.id))samples.set(p.id,p);};add(replies.posts);
  let unchanged=0;
  for(let i=0;i<10&&samples.size<20&&unchanged<3;i++){
   await check(run.token);const before=samples.size;const more=await send(workerTab,{op:'scroll'});
   if(more.owner!==run.owner)throw Error('登录账号变化');add(more.posts);unchanged=samples.size===before?unchanged+1:0;
  }
  posts=[...samples.values()].slice(0,20);
  }
  const decision=C.decide(profile,posts,config);
  let result={...base,profile,decision,status:decision.match?'matched':'not_matched'};await record(result);
  if(!decision.match||run.action!=='block')return;
  // Refresh country/client and numeric identity immediately before submission.
  const freshAbout=await visit(workerTab,`https://x.com/${handle}/about`,'about',handle,run.token);
  snap=await visit(workerTab,`https://x.com/${handle}`,'profile',handle,run.token);
  const fresh={...snap.profile,...freshAbout.about};
  if(fresh.id!==profile.id||!C.decide(fresh,posts,C.settings((await chrome.storage.local.get('config')).config)).match)throw Error('账号资料或规则变化，已取消动作');
  await check(run.token);
  const live=await check(run.token);if(live.confirmed>=live.target)throw Error('目标已完成');
  result={...result,status:'pending_action'};await record(result);await check(run.token);
  const outcome=await send(workerTab,{op:'block',handle,id:profile.id,token:run.token,owner:run.owner,assessment:{location:fresh.location,client:fresh.client,posts}});
  if(!outcome.confirmed)throw Error('没有收到新增屏蔽的确认');
  await record({...result,status:'blocked',completed:Date.now()});
  await serial(async()=>{const r=await getRun();if(r?.token===run.token)await saveRun({...r,confirmed:(r.confirmed||0)+1});});
 }catch(e){
  const {records=[]}=await chrome.storage.local.get('records');const previous=records.find(r=>r.key===key)||base;
  await record({...previous,status:previous.status==='pending_action'?'unknown':'error',error:e.message});
  if(previous.status==='pending_action'||/限流|登录|账号变化|任务已|目标已/.test(e.message))await pause(e.message);
  else await serial(async()=>{const r=await getRun();if(r?.token!==run.token)return;const failures=(r.failures||0)+1;await saveRun({...r,failures,enabled:failures<3&&r.enabled,message:e.message});});
 }finally{if(workerTab)await chrome.tabs.remove(workerTab).catch(()=>{});}
}
function sourceList(currentUrl){
 const urls=[];
 try{const u=new URL(currentUrl);if(u.origin==='https://x.com'&&/^\/[\w]+\/status\/\d+$/.test(u.pathname))urls.unshift(u.origin+u.pathname);}catch{}
 for(const term of ['','傻逼','你妈','小丑'])urls.push('https://x.com/search?q='+encodeURIComponent((term+' lang:zh filter:replies -filter:retweets').trim())+'&src=typed_query&f=live');
 return [...new Set(urls)];
}
async function collect(run){
 if(run.sourceIndex>=run.sources.length){await pause('当前扫描来源已读完，未找到更多新候选；已完成数量见面板');return;}
 let collector=run.collectorTab,snapshot;
 if(!collector){collector=(await chrome.tabs.create({url:run.sources[run.sourceIndex],active:false})).id;await patchRun(run.token,{collectorTab:collector});}
 await patchRun(run.token,{message:`正在主动扫描来源 ${run.sourceIndex+1}/${run.sources.length}`});
 if(!run.sourceScrolls)snapshot=await visit(collector,run.sources[run.sourceIndex],'source','',run.token);
 for(let step=0;step<5;step++){
  let live=await check(run.token);
  if(!snapshot)snapshot=await send(collector,{op:'scroll'});
  if(snapshot.owner!==live.owner)throw Error('登录账号变化，停止扫描');
  const seen=new Set(live.seen||[]);const handles=[];
  for(const p of snapshot.posts||[])if(p.author!==live.owner&&!seen.has(p.author)){
   seen.add(p.author);
   handles.push(p.author);
  }
  const {records=[],config}=await chrome.storage.local.get(['records','config']);
  const allowed=C.settings(config).allowlist;
  await serial(async()=>{
   const r=await check(run.token);const next=S.addQueue(r,handles.filter(h=>!allowed.includes(h)),records);
   await saveRun({...next,seen:[...seen],sourceScrolls:(r.sourceScrolls||0)+1,stalls:handles.length?0:(r.stalls||0)+1});
  });
  live=await check(run.token);snapshot=null;
  if(live.sourceScrolls>=120||live.stalls>=5){
   await chrome.tabs.remove(collector).catch(()=>{});
   await patchRun(run.token,{collectorTab:null,sourceIndex:live.sourceIndex+1,sourceScrolls:0,stalls:0});return;
  }
  if(live.queue.length>=80)return;
 }
}
async function tick(){
 if(busy)return;busy=true;
 try{
  let run=await getRun();if(!run?.enabled)return;
  if(run.current){await recover(run);return;}
  if(!run.target){await pause('程序已更新，请选择新规则后重新启动');return;}
  if(run.confirmed>=run.target){await pause(`已确认屏蔽 ${run.confirmed} 人，目标完成`);return;}
  if(Date.now()<(run.nextAt||0))return;
  if(!run.queue.length){await collect(run);return;}
  await serial(async()=>{run=await getRun();if(!run?.enabled||!run.queue.length)return;run={...run,current:run.queue[0],queue:run.queue.slice(1),seen:[...new Set([...(run.seen||[]),run.queue[0]])],checked:(run.checked||0)+1,message:'正在核验 @'+run.queue[0]};await saveRun(run);});
  if(!run?.enabled||!run.current)return;
  await task(run.current,run);
  await patchRun(run.token,{current:null,workerTab:null,nextAt:Date.now()+1500,message:'等待下一项核验'});
 }catch(e){await pause(e.message);}finally{busy=false;const r=await getRun();if(r?.enabled)setTimeout(()=>void tick(),1600);}
}
void chrome.alarms.get('process').then(alarm=>{if(!alarm)return chrome.alarms.create('process',{periodInMinutes:0.5});});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='process')void tick();});
chrome.runtime.onStartup.addListener(()=>{void pause('浏览器已重启，请检查记录后重新启动');});
chrome.runtime.onInstalled.addListener(async()=>{
 const {config}=await chrome.storage.local.get('config');if(!config)await chrome.storage.local.set({config:C.defaults,records:[],budgets:{}});
 await pause('扩展已安装或更新，请在控制面板启动');
});
async function currentPage(){const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];if(!tab?.url?.startsWith('https://x.com/'))throw Error('请先打开已登录的 X 标签页，再点击扩展');const info=await send(tab.id,{op:'visible'});if(!C.validHandle(info.owner))throw Error('无法确认当前登录账号，请刷新 X 页面');return info;}
async function handleMessage(m,sender){
 const panel=sender.url===chrome.runtime.getURL('panel.html');
 if(m.op==='run'&&(panel||sender.url?.startsWith('https://x.com/')))return await getRun();
 if(m.op==='enqueue'){
  if(!sender.tab||!sender.url?.startsWith('https://x.com/'))throw Error('来源无效');
  return serial(async()=>{const run=await getRun();if(!run?.enabled||run.owner!==m.owner||sender.tab.id===run.workerTab)return {};
   const {records=[],config}=await chrome.storage.local.get(['records','config']);const allowed=C.settings(config).allowlist;
   const handles=Array.isArray(m.handles)?m.handles.slice(0,200).filter(h=>!allowed.includes(C.norm(h))&&!(run.seen||[]).includes(C.norm(h))):[];
   await saveRun(S.addQueue(run,handles,records));return {};});
 }
 if(!panel)throw Error('只能从扩展面板操作');
 if(m.op==='stop'){await pause('用户暂停');return {};}
 if(m.op==='save'){
  const config=C.settings(m.config);await pause('规则已更新，请重新启动');await chrome.storage.local.set({config});return {};
 }
 if(m.op==='start'){
  if(busy)throw Error('前一项任务正在收尾，请稍后启动');
  const oldRun=await getRun();if(oldRun?.current){await recover(oldRun);throw Error('检测到中断任务，已标记记录；请检查后再次启动');}
  const page=await currentPage(),config=C.settings((await chrome.storage.local.get('config')).config);
  if(oldRun?.collectorTab)await chrome.tabs.remove(oldRun.collectorTab).catch(()=>{});
  const sources=sourceList(page.url);
  await saveRun({owner:page.owner,token:crypto.randomUUID(),enabled:true,action:config.action,policy:config.policy,ruleKey:C.ruleKey(config),queue:[],target:1000,confirmed:0,checked:0,seen:[],failures:0,sources,sourceIndex:0,sourceScrolls:0,stalls:0,collectorTab:null,current:null,workerTab:null,message:'主动扫描已启动，目标 1000 个已确认屏蔽'});
  void tick();return {};
 }
 if(m.op==='inspect'){
  const run=await getRun();if(!run?.enabled)throw Error('请先启动');if(!C.validHandle(m.handle))throw Error('请输入有效用户名，不含 @');
  const page=await currentPage();if(page.owner!==run.owner)throw Error('当前账号不匹配');
  return serial(async()=>{const r=await getRun();const {records=[]}=await chrome.storage.local.get('records');await saveRun(S.addQueue(r,[m.handle],records));return {};});
 }
 if(m.op==='allow'){
  if(!C.validHandle(m.handle))throw Error('无效用户名');await pause('已加入白名单，请重新启动');
  const config=C.settings((await chrome.storage.local.get('config')).config);config.allowlist=[...new Set([...config.allowlist,C.norm(m.handle)])];await chrome.storage.local.set({config});return {};
 }
 if(m.op==='undo'){
  if(busy)throw Error('请暂停并等待当前核验结束后撤销');
  const page=await currentPage(),{records=[]}=await chrome.storage.local.get('records');const item=records.find(r=>r.key===m.key);
  if(!item||item.status!=='blocked'||item.owner!==page.owner)throw Error('不是本账号已确认的扩展屏蔽记录');
  busy=true;let tabId;
  try{
   await pause('正在撤销');const config=C.settings((await chrome.storage.local.get('config')).config);config.allowlist=[...new Set([...config.allowlist,item.handle])];await chrome.storage.local.set({config});
   const run={owner:page.owner,token:crypto.randomUUID(),enabled:true,action:'undo',queue:[],remaining:0,current:item.handle,message:'正在撤销 @'+item.handle};await saveRun(run);
   tabId=(await chrome.tabs.create({url:'https://x.com/'+item.handle,active:false})).id;
   await visit(tabId,'https://x.com/'+item.handle,'profile',item.handle,run.token);
   const result=await send(tabId,{op:'unblock',handle:item.handle,id:item.profile.id,owner:run.owner,token:run.token});
   if(!result.confirmed)throw Error('撤销结果未知');await record({...item,status:'undone',undone:Date.now()});return {};
  }catch(e){await record({...item,status:'undo_unknown',error:'撤销未确认：'+e.message});throw e;}
  finally{if(tabId)await chrome.tabs.remove(tabId).catch(()=>{});busy=false;await pause('撤销流程已结束，请检查记录后重新启动');const r=await getRun();if(r?.action==='undo')await patchRun(r.token,{current:null,workerTab:null});}
 }
 throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{handleMessage(m,sender).then(result=>respond({ok:true,result}),e=>respond({ok:false,error:e.message}));return true;});
