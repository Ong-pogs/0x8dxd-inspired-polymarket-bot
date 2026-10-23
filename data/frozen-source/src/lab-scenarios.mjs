import {snapshot,START} from './scenarios.mjs';
import {LAB,evaluateStrategy,strategySettle,labReport} from './strategies.mjs';
export function candles(now=START){const end=Math.floor(now/3600000)*3600000;return Array.from({length:169},(_,i)=>{const p=100000*Math.exp(Math.sin(i)*.007+i*.0001);return [end-(169-i)*3600000,p,p*1.001,p*.999,p,100];});}
export function directional({id='directional-1',t=0,strategy='ox',yes=.95,no=.05,depth=100,moveBps=5,feeRate=0}={}){
 const s=snapshot({id,t,yes,no,ys:depth,ns:100,bidYes:Math.max(.001,yes-.002),bidNo:Math.max(.001,no-.002)});
 s.market.fee.notionalRate=feeRate;s.reference={symbol:'BTC/USDT',source:'fixture',price:100000,timestamp:s.now};s.referenceHistory=[{...s.reference,timestamp:s.now-10000,price:100000/(1+moveBps/10000)}];
 if(strategy==='coinman'){s.market.labels=['Yes','No'];s.market.title='Will Bitcoin be above $98,000 on October 24?';s.market.end=START+86400000;s.contract={type:'terminal-range',source:'binance',symbol:'BTC/USDT',lower:98000,upper:null,end:s.market.end,rulesVerified:true};s.candles=candles(s.now);}
 return s;
}
const settlement=winner=>({verified:true,closed:true,conditionId:'test-condition',tokens:[{id:'test-up',winner:winner===0},{id:'test-down',winner:winner===1}],at:START+86401000});
export function labScenarios(){
 const up=directional(),partial=directional({depth:12});
 const stop=directional({id:'stop',t:10000,yes:.91,no:.09});
 const partialExit=structuredClone(stop);partialExit.id='partial-exit';partialExit.books[0].bids[0].size=4;
 const exit2=directional({id:'exit-2',t:12000,yes:.90,no:.10});
 const stale=directional({id:'stale'});stale.reference.timestamp-=9000;
 const coin=()=>directional({strategy:'coinman',yes:.50,no:.52});
 const noEdge=directional({id:'no-edge',strategy:'coinman',yes:.86,no:.16});
 const touch=coin();touch.id='touch';touch.contract={...touch.contract,type:'touch'};
 const wrongSource=coin();wrongSource.id='wrong-source';wrongSource.contract.source='chainlink';
 return [
  {id:'ox-win',strategy:'ox',title:'High-price winner',snapshots:[up],settlement:settlement(0)},
  {id:'ox-loss',strategy:'ox',title:'One loss wipes out many small wins',snapshots:[up],settlement:settlement(1)},
  {id:'ox-stop',strategy:'ox',title:'The adverse move triggers an exit',snapshots:[up,stop]},
  {id:'ox-partial',strategy:'ox',title:'Only three shares fill',snapshots:[partial,partialExit,exit2]},
  {id:'ox-no-move',strategy:'ox',title:'Price alone is not the signal',snapshots:[directional({moveBps:.2})]},
  {id:'ox-fees',strategy:'ox',title:'Costs exceed the winning payout',snapshots:[directional({feeRate:.1})]},
  {id:'ox-stale',strategy:'ox',title:'Stale external price rejected',snapshots:[stale]},
  {id:'coin-win',strategy:'coinman',title:'Model entry wins at verified settlement',snapshots:[coin()],settlement:settlement(0)},
  {id:'coin-loss',strategy:'coinman',title:'The same model entry can lose',snapshots:[coin()],settlement:settlement(1)},
  {id:'coin-no-edge',strategy:'coinman',title:'Price is too close to the estimate',snapshots:[noEdge]},
  {id:'coin-touch',strategy:'coinman',title:'Touch contract rejected',snapshots:[touch]},
  {id:'coin-source',strategy:'coinman',title:'Different resolution source rejected',snapshots:[wrongSource]}
 ];
}
export function evaluatedScenarios(){return labScenarios().map(s=>{const e=evaluateStrategy(s.strategy,s.snapshots);if(s.settlement){strategySettle(e.state,'test-condition',s.settlement);e.settlementReport=labReport(e.state);}return {...s,...e};});}
