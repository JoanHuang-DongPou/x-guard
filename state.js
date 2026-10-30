(function(root){
 const C=typeof module!=='undefined'&&module.exports?require('./core.js'):root.ReplyGuard;
 function authorized(run,owner,token){return !!run?.enabled&&run.owner===owner&&run.token===token;}
 function addQueue(run,handles,records,now=Date.now()){
  const queue=[...run.queue];
  if(run.target&&run.confirmed>=run.target)return {...run,queue};
  const cap=run.target?5000:run.remaining;
  for(const input of handles){const h=C.norm(input);
   if(queue.length>=cap)break;
   if(!C.validHandle(h)||h===run.owner||h===run.current||queue.includes(h)||records.some(r=>r.owner===run.owner&&r.handle===h&&((run.ruleKey?r.ruleKey===run.ruleKey:r.policy===run.policy)||['blocked','unknown','pending_action','undo_unknown'].includes(r.status))&&now-r.time<86400000))continue;
   queue.push(h);
  }return {...run,queue};
 }
 function canReserve(budget,day){return budget?.day!==day||budget.count<10;}
 const api={authorized,addQueue,canReserve};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReplyGuardState=api;
})(globalThis);
