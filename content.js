(()=>{
 'use strict';const C=ReplyGuard,D=ReplyGuardDOM;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(fn,timeout=15000){const end=Date.now()+timeout;do{const r=fn();if(r)return r;await sleep(250);}while(Date.now()<end);throw Error('页面加载超时或结构变化');}
 function errorCheck(){const t=D.text(document.querySelector('[data-testid="primaryColumn"]'));
  if(/Rate limit exceeded|Something went wrong|出错了|出了点问题|请求过于频繁/.test(t))throw Error('X 页面报错或限流，请稍后手动重新启动');
 }
 async function guard(m){
  const {result:run}=await chrome.runtime.sendMessage({op:'run'});
  if(!run?.enabled||run.token!==m.token||D.owner(document)!==run.owner||run.owner!==m.owner)throw Error('已暂停或登录账号改变');
  if(!C.validHandle(m.handle)||location.pathname.split('/')[1].toLowerCase()!==m.handle.toLowerCase())throw Error('账号页面不匹配');
  errorCheck();return run;
 }
 async function action(m){
  await guard(m);const p=D.profile(document,m.handle);
  if(p.id!==m.id||!p.id)throw Error('账号 ID 改变或缺失');
  if(m.op==='block'){
   if(p.blocked)return {already:true};
   if(p.following!==false)throw Error('关注状态变化，取消屏蔽');
   const run=await guard(m);const {config}=await chrome.storage.local.get('config');
   if(C.settings(config).allowlist.includes(m.handle)||run.action!=='block')throw Error('动作已取消');
   if(C.settings(config).policy==='two_of_four'||config.criteria){
    if(!m.assessment||!C.decide({...p,location:m.assessment.location,client:m.assessment.client},m.assessment.posts||[],config).match)throw Error('提交前不满足两项条件');
   }else if(p.followers===null||p.followers>=10)throw Error('粉丝条件变化');
   const more=document.querySelector('[data-testid="primaryColumn"] [data-testid="userActions"]');if(!more)throw Error('找不到账号菜单');more.click();
   const menu=await until(()=>[...document.querySelectorAll('[role="menuitem"]')].find(e=>new RegExp(`^(?:Block|屏蔽|封鎖|封锁)\\s*@${m.handle}$`,'i').test(D.text(e))));
   await guard(m);menu.click();
  }else{
   if(p.blocked!==true)throw Error('当前账号不处于屏蔽状态');
   const button=document.querySelector(`[data-testid="${m.id}-unblock"]`);if(!button)throw Error('找不到解除屏蔽按钮');button.click();
  }
  const confirm=await until(()=>document.querySelector('[data-testid="confirmationSheetConfirm"]'));
  const dialog=confirm.closest('[role="dialog"]')||document.querySelector('[role="alertdialog"]');
  if(!dialog||!D.text(dialog).toLowerCase().includes('@'+m.handle.toLowerCase()))throw Error('确认对话框账号不匹配');
  const label=D.text(confirm);
  if(m.op==='block'&&!/^(Block|屏蔽|封鎖|封锁)$/.test(label))throw Error('不是屏蔽确认按钮');
  if(m.op==='unblock'&&!/^(Unblock|解除屏蔽|取消屏蔽|解除封鎖|取消封鎖)$/.test(label))throw Error('不是解除屏蔽确认按钮');
  await guard(m);confirm.click();
  await until(()=>{const current=D.profile(document,m.handle);return current.id===m.id&&current.blocked===(m.op==='block');},12000);
  return {confirmed:true};
 }
 chrome.runtime.onMessage.addListener((m,s,respond)=>{
  if(s.id!==chrome.runtime.id)return;
  (async()=>{
   if(m.op==='snapshot'){
    await until(()=>D.owner(document));errorCheck();
    if(m.kind==='profile')await until(()=>D.profile(document,m.handle).id);
    if(m.kind==='about')await until(()=>document.querySelector('[data-testid="pivot"]'));
    if(m.kind==='source')await until(()=>document.querySelector('article')||/No results|没有找到|找不到結果/.test(D.text(document.querySelector('main'))));
    if(m.kind==='replies'){
     const q=new URL(location.href).searchParams.get('q');
     if(location.pathname!=='/search'||q!==`from:${m.handle} filter:replies -filter:retweets`)throw Error('不是预期的本人回复搜索');
     await until(()=>document.querySelector('article')||/No results|没有找到|找不到結果/.test(D.text(document.querySelector('main'))));
    }
    return {owner:D.owner(document),profile:D.profile(document,m.handle),about:D.about(document),posts:D.posts(document)};
   }
   if(m.op==='scroll'){errorCheck();window.scrollBy(0,window.innerHeight*0.85);await sleep(1200);return {posts:D.posts(document),owner:D.owner(document)};}
   if(m.op==='block'||m.op==='unblock')return await action(m);
   if(m.op==='visible')return {owner:D.owner(document),posts:D.posts(document),url:location.href};
   throw Error('未知指令');
  })().then(result=>respond({ok:true,result}),e=>respond({ok:false,error:e.message}));return true;
 });
 let sent=new Set(),lastRoute='',scanBusy=false;
 async function scan(){
  if(scanBusy||document.hidden)return;scanBusy=true;
  try{
   const {result:run}=await chrome.runtime.sendMessage({op:'run'});if(!run?.enabled)return;
   if(lastRoute!==location.href){sent=new Set();lastRoute=location.href;}
   if(!/^\/[\w]+\/status\/\d+/.test(location.pathname))return;
   const owner=D.owner(document);if(owner!==run.owner)return;
   const rootId=location.pathname.split('/')[3];
   const candidates=D.posts(document).filter(p=>p.id!==rootId&&p.author!==owner&&!sent.has(p.author));
   if(candidates.length){const reply=await chrome.runtime.sendMessage({op:'enqueue',owner,handles:candidates.map(p=>p.author)});if(reply?.ok)candidates.forEach(p=>sent.add(p.author));}
   const {records=[]}=await chrome.storage.local.get('records');
   if(run.action==='hide')for(const article of document.querySelectorAll('article')){
    if(article.dataset.replyGuardHidden)continue;
    const posts=D.posts({querySelectorAll:()=>[article]});const p=posts[0];
    if(!p||!records.some(r=>r.owner===owner&&r.handle===p.author&&r.decision?.match&&r.ruleKey===run.ruleKey&&Date.now()-r.time<86400000))continue;
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Reply Guard：已折叠 @${p.author} 的回复（点击展开）`;details.style.cssText='padding:12px;color:#9acaff;border:1px solid #536471';article.before(details);details.append(summary,article);article.dataset.replyGuardHidden='1';
   }
  }catch{}finally{scanBusy=false;}
 }
 setInterval(scan,5000);
})();
