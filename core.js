(function(root){
 'use strict';
 const defaults=Object.freeze({policy:'two_of_four',action:'record',allowlist:[]});
 const criteriaIds=Object.freeze(['location','client','followers','abuse']);
 const criteriaLabels={location:'香港／日本地区',client:'China Android App',followers:'粉丝少于10',abuse:'反复明确辱骂'};
 const validHandle=h=>typeof h==='string'&&/^[a-zA-Z0-9_]{1,15}$/.test(h);
 const norm=h=>String(h||'').replace(/^@/,'').toLowerCase();
 function settings(input={}){
  const s={...defaults,...input};
  if(!['strict','behavior','two_of_four'].includes(s.policy)||!['record','hide','block'].includes(s.action)) throw Error('无效策略或动作');
  if(!Array.isArray(s.allowlist)||s.allowlist.some(h=>!validHandle(h))) throw Error('白名单用户名格式错误');
  const criteria=input.criteria??(s.policy==='behavior'?['followers','abuse']:[...criteriaIds]);
  const minMatches=input.minMatches??(input.criteria?2:s.policy==='strict'?4:2);
  if(!Array.isArray(criteria)||criteria.length<2||criteria.length>4||new Set(criteria).size!==criteria.length||criteria.some(k=>!criteriaIds.includes(k)))throw Error('至少选择两个不同的有效条件');
  if(!Number.isInteger(minMatches)||minMatches<2||minMatches>criteria.length)throw Error('命中数量不能超过已选条件数');
  return {policy:s.policy,action:s.action,allowlist:[...new Set(s.allowlist.map(norm))],criteria:[...criteria],minMatches};
 }
 function ruleKey(input){const s=settings(input);return `${[...s.criteria].sort().join(',')}:${s.minMatches}`;}
 function parseFollowers(text){
  const m=String(text||'').trim().match(/^([\d,]+)\s*(?:Followers?|位?关注者|位?跟隨者|粉丝|粉絲)$/i);
  if(!m)return null;
  const n=Number(m[1].replaceAll(',',''));return Number.isSafeInteger(n)&&n>=0?n:null;
 }
 function classify(text){
  const t=String(text||'').normalize('NFKC');
  // Ambiguous quotation and anti-abuse discussion are deliberately deferred.
  if(/[“”「」『』"<>]|(?:不要|别再|別再|不能|不该|不該|反对|反對|拒绝|拒絕|停止).{0,10}(?:骂|罵|侮辱|辱骂)|(?:他说|她说|原话|引用|被骂|被罵|这种辱骂|這種辱罵)/u.test(t))return {abusive:false,ambiguous:true,tags:[]};
  const rules=[
   ['直接辱骂',/(?:你|您|妳|你们|你們).{0,12}(?:傻[逼比屄]|煞笔|煞筆|脑残|腦殘|智障|弱智|废物|廢物|畜[生牲]|狗东西|狗東西)/u],
   ['智力与人格攻击',/(?:你|妳|你们|你們).{0,12}(?:智商低|没[有]?智商|沒有智商|没[有]?人性|沒有人性|什么东西|什麼東西)|(?:你真是小丑)/u],
   ['亲属诅咒',/(?:你[妈媽]|你全家|全家).{0,5}(?:死了|死光|暴毙|暴斃)|(?:操|肏|艹)你[妈媽]/u],
   ['去人化贬称',/(?:殖畜|支猪|支豬|粉蛆|翻墙蛆|翻牆蛆)/u],
   ['性羞辱',/(?:你|你们|你們).{0,35}(?:舔.{0,10}(?:屌|鸡巴|雞巴)|卖[逼屄]|賣[逼屄])/u]
  ];
  const tags=rules.filter(([,r])=>r.test(t)).map(([name])=>name);
  return {abusive:tags.length>0,ambiguous:false,tags};
 }
 function decide(profile,posts,input=defaults){
  const s=settings(input),p=profile||{},reasons=[];
  const unique=new Map();
  for(const r of posts||[])if(r.id&&norm(r.author)===norm(p.handle)&&!unique.has(r.id))unique.set(r.id,r);
  const sample=[...unique.values()].slice(0,20);
  const evidence=sample.map(r=>({...r,...classify(r.text)})).filter(r=>r.abusive);
  if(!validHandle(p.handle))reasons.push('账号标识缺失');
  if(p.following!==false)reasons.push('已关注或关注状态未知');
  if(p.blocked!==false)reasons.push('已屏蔽或屏蔽状态未知');
  if(s.allowlist.includes(norm(p.handle)))reasons.push('白名单');
  const flags={
   followers:Number.isSafeInteger(p.followers)&&p.followers>=0&&p.followers<10,
   location:['hong kong','hong kong sar china','hong kong sar','japan','香港','日本','中国香港','中國香港'].includes(String(p.location||'').trim().toLowerCase()),
   client:/^china android app$/i.test(String(p.client||'').trim()),
   abuse:sample.length>=10&&evidence.length>=5&&evidence.length>=sample.length/2
  };
  const matchedIds=s.criteria.filter(k=>flags[k]),matchedCriteria=matchedIds.map(k=>criteriaLabels[k]);
  const needsReplies=reasons.length===0&&!flags.abuse&&s.criteria.includes('abuse')&&matchedIds.length<s.minMatches&&matchedIds.length+1>=s.minMatches;
  if(matchedIds.length<s.minMatches)reasons.push(`已选条件命中 ${matchedIds.length} 项，需要 ${s.minMatches} 项`);
  return {match:reasons.length===0,reasons,total:sample.length,hits:evidence.length,evidence,matchedCriteria,matchedIds,needsReplies,ruleKey:ruleKey(s)};
 }
 const api={defaults,criteriaIds,criteriaLabels,settings,ruleKey,validHandle,norm,parseFollowers,classify,decide};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReplyGuard=api;
})(globalThis);
