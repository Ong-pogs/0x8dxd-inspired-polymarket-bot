import {createHash} from 'node:crypto';
import {quote,round,validate} from './engine.mjs';

export const LAB=Object.freeze({bankroll:1000,shares:10,slippage:.001,participation:.25,maxAgeMs:5000,maxSkewMs:2000,futureMs:500,marketBudget:20,openBudget:100,minRemainingMs:45000,holdMs:30000,stopFraction:.02,minMoveBps:2,minSignalMs:8000,maxSignalMs:15000,minAsk:.90,maxAsk:.985,minWinningSurplus:.005,modelHaircut:.03,minModelEdge:.05,minCandles:60});
const YEAR=365.25*86400000;
export function normalCdf(x){const t=1/(1+.2316419*Math.abs(x)),d=.3989422804014327*Math.exp(-x*x/2),p=1-d*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?p:1-p;}
export function realizedVol(candles,now,{hours=1,min=LAB.minCandles}={}){
 const closed=candles.filter(c=>Array.isArray(c)&&c.length>=5&&Number.isFinite(c[0])&&c[0]+hours*3600000<=now&&Number.isFinite(c[4])&&c[4]>0).sort((a,b)=>a[0]-b[0]);
 if(closed.length<min+1)throw Error('INSUFFICIENT_CLOSED_CANDLES');
 if(closed.some((c,i)=>i&&c[0]-closed[i-1][0]!==hours*3600000))throw Error('CANDLE_GAP');
 const returns=closed.slice(1).map((c,i)=>Math.log(c[4]/closed[i][4])),mean=returns.reduce((a,x)=>a+x,0)/returns.length;
 const sigma=Math.sqrt(returns.reduce((a,x)=>a+(x-mean)**2,0)/(returns.length-1)*365.25*24/hours);
 if(!Number.isFinite(sigma)||sigma<.05||sigma>3)throw Error('VOLATILITY_OUT_OF_BOUNDS');
 return {annualized:sigma,candles:closed.length,lastCloseAt:closed.at(-1)[0]+hours*3600000};
}
export function parseContract(title,description,end){
 if(!Number.isFinite(end)||!/Binance/.test(description)||!/BTC\/USDT/.test(description)||!/final ["“]?Close|close price/i.test(description))return null;
 if(/touch|reach|dip|hit|dominance/i.test(title))return null;
 let lower=0,upper=Infinity,m;
 if(m=title.match(/^Will the price of Bitcoin be between \$([\d,]+) and \$([\d,]+) on /i)){lower=Number(m[1].replaceAll(',',''));upper=Number(m[2].replaceAll(',',''));}
 else if(m=title.match(/^Will (?:the price of )?Bitcoin be (?:greater than|above) \$([\d,]+) on /i))lower=Number(m[1].replaceAll(',',''));
 else if(m=title.match(/^Will (?:the price of )?Bitcoin be (?:less than|below) \$([\d,]+) on /i))upper=Number(m[1].replaceAll(',',''));
 else return null;
 if(!(upper>lower)||lower<0)return null;
 return {type:'terminal-range',symbol:'BTC/USDT',source:'binance',end,lower,upper:Number.isFinite(upper)?upper:null,rulesVerified:true};
}
export function terminalProbability(contract,spot,sigma,now){
 if(!contract?.rulesVerified||contract.type!=='terminal-range'||contract.source!=='binance'||contract.symbol!=='BTC/USDT')throw Error('CONTRACT_UNSUPPORTED');
 if(!(spot>0)||!(sigma>0)||!Number.isFinite(sigma)||contract.end<=now)throw Error('INVALID_MODEL_INPUT');
 const years=(contract.end-now)/YEAR,sd=sigma*Math.sqrt(years),mean=Math.log(spot)-.5*sigma*sigma*years;
 const lower=contract.lower===0?0:normalCdf((Math.log(contract.lower)-mean)/sd),upper=contract.upper===null?1:normalCdf((Math.log(contract.upper)-mean)/sd);
 return Math.max(0,Math.min(1,upper-lower));
}
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
  if(state.strategy==='coinman')return emit('HOLD',{reason:'AWAITING_VERIFIED_SETTLEMENT'});
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
 }else if(state.strategy==='coinman'){
  if(s.market.labels[0]!=='Yes'||s.market.labels[1]!=='No')return emit('SKIP',{reason:'LABELS_UNVERIFIED'});
  try{const v=realizedVol(s.candles||[],s.now,{min:c.minCandles});probability=terminalProbability(s.contract,s.reference.price,v.annualized,s.now);signal={probability,volatility:v.annualized,candles:v.candles,spot:s.reference.price,contract:s.contract};}
  catch(e){return emit('SKIP',{reason:e.message});}
  const candidates=s.books.map((b,i)=>{const q=quote(b,'buy',c.shares,s.market.fee,c),p=i===0?probability:1-probability;return {leg:i,q,edge:q.shares?p-c.modelHaircut-q.total/q.shares:-Infinity};}).sort((a,b)=>b.edge-a.edge);
  leg=candidates[0].leg;netEdge=candidates[0].edge;
  if(!(netEdge>=c.minModelEdge))return emit('SKIP',{reason:'NO_MODELED_EDGE',signal,netEdge:Number.isFinite(netEdge)?netEdge:null});
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
