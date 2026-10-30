(function(root){
 'use strict';
 const C=typeof module!=='undefined'&&module.exports?require('./core.js'):root.ReplyGuard;
 const text=e=>(e?.innerText||e?.textContent||'').trim();
 const path=e=>{try{return new URL(e.getAttribute('href'),'https://x.com').pathname;}catch{return '';}};
 function owner(d){
  const p=d.querySelector('a[data-testid="AppTabBar_Profile_Link"]');if(p)return C.norm(path(p).split('/')[1]);
  const avatar=d.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"]');
  const h=avatar?.getAttribute('data-testid').replace('UserAvatar-Container-','');return C.validHandle(h)?C.norm(h):null;
 }
 function ownText(article){
  const el=article.querySelector('[data-testid="tweetText"]');if(!el)return null;
  for(let e=el.parentElement;e&&e!==article;e=e.parentElement)if(e.getAttribute('role')==='link'||e.getAttribute('data-testid')==='quoteTweet')return null;
  return text(el);
 }
 function posts(d){
  return [...d.querySelectorAll('article')].flatMap(article=>{
   if(article.querySelector('[data-testid="socialContext"]'))return [];
   const name=article.querySelector('[data-testid="User-Name"]');if(!name)return [];
   const link=[...name.querySelectorAll('a[href]')].find(a=>/^\/[\w]+\/status\/\d+$/.test(path(a))&&a.querySelector('time'));
   if(!link)return [];
   const [,author,,id]=path(link).split('/'),body=ownText(article);
   if(!C.validHandle(author)||!body)return [];
   return [{author:C.norm(author),id,text:body.slice(0,4000),url:'https://x.com'+path(link)}];
  });
 }
 function profile(d,handle){
  const column=d.querySelector('[data-testid="primaryColumn"]')||d.querySelector('main');
  const action=column?.querySelector('[data-testid="userActions"]');
  const controls=action?.parentElement;
  const buttons=[...(controls?.querySelectorAll('button[data-testid]')||[])];
  const identity=buttons.map(b=>b.getAttribute('data-testid')?.match(/^(\d+)-(follow|unfollow|unblock)$/)).find(Boolean);
  const link=[...(column?.querySelectorAll('a[href]')||[])].find(a=>new RegExp(`^/${handle}/(?:verified_followers|followers)$`,'i').test(path(a)));
  const id=identity?.[1]||null,kind=identity?.[2];
  return {handle:C.norm(handle),id,followers:C.parseFollowers(text(link)),following:identity?kind==='unfollow':null,blocked:identity?kind==='unblock':null};
 }
 function about(d){
  const fields=[...d.querySelectorAll('[role="tab"]')].map(text);
  const read=regex=>{const f=fields.find(t=>regex.test(t));return f?f.replace(regex,'').trim():null;};
  return {location:read(/^(?:Account based in|账号所在地|帳戶所在地|账号所在地区|帳戶所在位置)\s*/i),client:read(/^(?:Connected via|连接方式|連接方式|通过以下方式连接|透過以下方式連線)\s*/i)};
 }
 const api={text,path,owner,posts,profile,about};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReplyGuardDOM=api;
})(globalThis);
