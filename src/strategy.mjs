import {createHash} from 'node:crypto';
import {quote,round,validate} from './engine.mjs';

export const LAB=Object.freeze({bankroll:1000,shares:10,slippage:.001,participation:.25,maxAgeMs:5000,maxSkewMs:2000,futureMs:500,marketBudget:20,openBudget:100,minRemainingMs:45000,holdMs:30000,stopFraction:.02,minMoveBps:2,minSignalMs:8000,maxSignalMs:15000,minAsk:.90,maxAsk:.985,minWinningSurplus:.005,modelHaircut:.03,minModelEdge:.05,minCandles:60});
function reference(s,c){
 const p=s.reference;
 if(!p||p.symbol!=='BTC/USDT'||!['binance-rest','binance-ws','fixture'].includes(p.source)||!(p.price>0)||!Number.isFinite(p.timestamp))return 'REFERENCE_UNVERIFIED';
 if(p.timestamp>s.now+c.futureMs)return 'FUTURE_REFERENCE';
 if(s.now-p.timestamp>c.maxAgeMs)return 'STALE_REFERENCE';
 return null;
}
export function momentum(s,c=LAB){
 const invalid=reference(s,c);if(invalid)return {error:invalid};
 const latest=s.reference,prior=(s.referenceHistory||[]).filter(p=>p.symbol===latest.symbol&&p.source===latest.source&&p.price>0&&p.timestamp<=latest.timestamp-c.minSignalMs&&p.timestamp>=latest.timestamp-c.maxSignalMs).sort((a,b)=>b.timestamp-a.timestamp)[0];
 if(!prior)return {error:'SIGNAL_WARMUP'};
 const moveBps=(latest.price/prior.price-1)*10000;
 return {moveBps,from:prior.timestamp,to:latest.timestamp,leg:moveBps>=0?0:1,spanMs:latest.timestamp-prior.timestamp};
}
export function freshState(strategy,c=LAB){return {version:1,strategy,cash:c.bankroll,initialCash:c.bankroll,positions:{},seen:[],events:[],realized:0,lastNow:0};}
function baseCheck(s,c){
 // A single directional claim does not depend on negative-risk cross-condition conversion.
 if(typeof s?.market?.negRisk!=='boolean')return 'IDENTITY_UNVERIFIED';
 const invalid=validate({...s,market:{...s.market,negRisk:false}},c);if(invalid)return invalid;
 if(s.market.labels?.length!==2)return 'LABELS_UNVERIFIED';
 return null;
}
export function labReport(state,latest={}){
 const positions=Object.values(state.positions).map(p=>{const b=latest[p.id];const open=p.shares>1e-6;const q=open&&b?quote(b[p.leg],'sell',p.shares,p.fee,p.config):null;
  return {...p,liquidationValue:q?.total??(open?null:0),liquidatableShares:q?.shares??0,unfilledExitShares:q?round(p.shares-q.shares):p.shares,conditionalWinningSurplus:open?round(p.shares-p.cost):0};});
 const openCost=round(positions.reduce((v,p)=>v+p.cost,0)),mark=positions.every(p=>p.shares<=1e-6||p.liquidationValue!==null)?round(state.cash+positions.reduce((v,p)=>v+(p.liquidationValue||0),0)-state.initialCash):null;
 return {cash:state.cash,realized:state.realized,openCost,liquidationMarkPnl:mark,openPositions:positions.filter(p=>p.shares>1e-6).length,positions,events:state.events.length};
}
export function strategyStep(state,s,settings=LAB,{priceOnly=false}={}){
 const c={...LAB,...settings};
 const digest=createHash('sha256').update(JSON.stringify(s)).digest('hex'),prior=state.seen.find(x=>x.id===s.id);
 if(prior){if(prior.digest!==digest)throw Error('Snapshot id collision');return {action:'DUPLICATE',id:s.id};}
 state.seen.push({id:s.id,digest});
 const emit=(action,extra={})=>{const e={index:state.events.length,id:s.id,now:s.now,marketId:s.market?.id,action,...extra};state.events.push(e);return e;};
 const invalid=baseCheck(s,c);if(invalid)return emit('SKIP',{reason:invalid});
 if(s.now<state.lastNow)return emit('SKIP',{reason:'OUT_OF_ORDER'});state.lastNow=s.now;
 let p=state.positions[s.market.id];
 if(p){
  if(JSON.stringify(p.tokens)!==JSON.stringify(s.market.tokens))return emit('SKIP',{reason:'IDENTITY_CHANGED'});
  if(p.shares<=1e-6)return emit('SKIP',{reason:p.settled?'SETTLED':'ALREADY_TRADED'});
  const exit=quote(s.books[p.leg],'sell',p.shares,p.fee,c),basisUnit=p.cost/p.shares;
  const stop=exit.shares>0&&exit.total/exit.shares<=basisUnit*(1-c.stopFraction);
  if(!stop&&s.now-p.enteredAt<c.holdMs&&s.market.end-s.now>=c.minRemainingMs&&!p.exiting)return emit('HOLD',{reason:'WITHIN_HOLD_WINDOW'});
  p.exiting=true;const basis=round(basisUnit*exit.shares),gain=round(exit.total-basis);
  state.cash=round(state.cash+exit.total);state.realized=round(state.realized+gain);p.realized=round(p.realized+gain);p.cost=round(p.cost-basis);p.shares=round(p.shares-exit.shares);
  return emit('EXIT',{reason:p.shares>1e-6?'PARTIAL_EXIT':stop?'STOP_LOSS':'TIME_EXIT',quote:exit,realized:gain,remainingShares:p.shares});
 }
 if(s.market.end-s.now<c.minRemainingMs)return emit('SKIP',{reason:'TOO_CLOSE_TO_RESOLUTION'});
 const badReference=reference(s,c);if(badReference&&!priceOnly)return emit('SKIP',{reason:badReference});
 let leg,signal,probability,netEdge;
 if(state.strategy==='ox'){
  if(!/^Bitcoin Up or Down/.test(s.market.title)||s.market.labels[0]!=='Up'||s.market.labels[1]!=='Down')return emit('SKIP',{reason:'MARKET_TYPE_UNSUPPORTED'});
  if(priceOnly){const asks=s.books.map(b=>b.asks[0]?.price);leg=asks.findIndex(p=>p>=c.minAsk&&p<=c.maxAsk);if(leg<0)return emit('SKIP',{reason:'HIGH_PRICE_FILTER'});signal={baseline:true};}
  else{signal=momentum(s,c);if(signal.error)return emit('SKIP',{reason:signal.error});if(Math.abs(signal.moveBps)<c.minMoveBps)return emit('SKIP',{reason:'MOVE_TOO_SMALL',signal});leg=signal.leg;}
  const ask=s.books[leg].asks[0]?.price;
  if(!(ask>=c.minAsk&&ask<=c.maxAsk))return emit('SKIP',{reason:'HIGH_PRICE_FILTER',signal});
 }else throw Error('Unknown strategy');
 const q=quote(s.books[leg],'buy',c.shares,s.market.fee,c,state.strategy==='ox'?c.maxAsk:1);
 if(q.shares<=1e-6)return emit('SKIP',{reason:'NO_DEPTH',signal});
 if(state.strategy==='ox'&&1-q.total/q.shares<c.minWinningSurplus)return emit('SKIP',{reason:'COST_EXCEEDS_WINNING_PAYOUT',signal,quote:q});
 const open=Object.values(state.positions).reduce((v,p)=>v+p.cost,0);
 if(q.total>state.cash||q.total>c.marketBudget||open+q.total>c.openBudget)return emit('SKIP',{reason:'BUDGET',signal});
 state.cash=round(state.cash-q.total);state.positions[s.market.id]={id:s.market.id,title:s.market.title,tokens:s.market.tokens,leg,label:s.market.labels[leg],shares:q.shares,cost:q.total,fee:s.market.fee,config:c,enteredAt:s.now,realized:0,settled:false};
 return emit('BUY',{leg,label:s.market.labels[leg],quote:q,signal,netEdge:netEdge??null});
}
export function strategySettle(state,id,evidence){
 const p=state.positions[id];if(!p)throw Error('Unknown position');if(p.settled)return {action:'DUPLICATE_SETTLEMENT'};
 if(evidence?.verified!==true||evidence.closed!==true||evidence.conditionId!==id||!Array.isArray(evidence.tokens)||evidence.tokens.length!==2||new Set(evidence.tokens.map(t=>t.id)).size!==2||evidence.tokens.filter(t=>t.winner===true).length!==1||p.tokens.some(t=>!evidence.tokens.some(x=>x.id===t)))throw Error('Settlement not verified');
 const payout=evidence.tokens.find(t=>t.id===p.tokens[p.leg]).winner?p.shares:0,gain=round(payout-p.cost);
 state.cash=round(state.cash+payout);state.realized=round(state.realized+gain);p.realized=round(p.realized+gain);p.shares=0;p.cost=0;p.settled=true;
 const e={action:'SETTLE',marketId:id,payout,realized:gain,at:evidence.at};state.events.push(e);return e;
}
export function evaluateStrategy(strategy,snapshots,settings=LAB,options={}){
 const state=freshState(strategy,settings),frames=[],latest={};
 for(const snapshot of snapshots){const before=labReport(state,latest),decision=strategyStep(state,snapshot,settings,options);latest[snapshot.market.id]=snapshot.books;frames.push({snapshot,before,decision,after:labReport(state,latest)});}
 return {strategy,frames,state,report:labReport(state,latest),snapshotCount:snapshots.length,actions:state.events.reduce((a,e)=>(a[e.action]=(a[e.action]||0)+1,a),{})};
}
