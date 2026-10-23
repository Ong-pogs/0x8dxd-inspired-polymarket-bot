import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {ReadAPI,venue} from './lab-api.mjs';import {LAB,parseContract,evaluateStrategy,freshState,strategyStep,labReport} from './strategies.mjs';import {persist,acquire} from './store.mjs';
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
export const frozenFiles=['THREE-BOTS.md','src/strategies.mjs','src/lab-api.mjs','src/lab-collect.mjs','src/lab-scenarios.mjs','test/strategies.test.mjs','test/lab-api.test.mjs'];
export function freezeLab(){fs.mkdirSync('data/lab',{recursive:true});const f={frozenAt:new Date().toISOString(),config:LAB,files:Object.fromEntries(frozenFiles.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))};persist('data/lab/frozen-rules.json',f);return f;}
export function verifyFrozen(){const f=JSON.parse(fs.readFileSync('data/lab/frozen-rules.json','utf8'));for(const [file,hash] of Object.entries(f.files))if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error('Frozen rules changed: '+file);return f;}
function ticker(r){const d=r.body.data;return {symbol:d.symbol,price:d.last??d.close,timestamp:d.timestamp,source:d.provenance?.source,asOf:d.asOf,receivedAt:r.receivedAt};}
async function identity(m){
 const condition=m.sourceMetadata?.nativeMarketId;if(!/^0x[a-f\d]{64}$/i.test(condition||''))throw Error('Missing condition');
 const native=await venue('https://clob.polymarket.com/markets/'+condition);
 if(native.condition_id!==condition||!native.active||native.closed||!native.accepting_orders||native.tokens?.length!==2||typeof native.neg_risk!=='boolean')throw Error('Inactive/unverified market');
 const labels=/^Bitcoin Up or Down/.test(m.title)?['Up','Down']:['Yes','No'];
 const tokens=labels.map(label=>native.tokens.find(t=>t.outcome===label)?.token_id);
 if(tokens.some(t=>!t)||new Set(tokens).size!==2||tokens.some(t=>!m.outcomes.some(o=>String(o.outcomeId)===t)))throw Error('Token mismatch');
 const rates=await Promise.all(tokens.map(t=>venue('https://clob.polymarket.com/fee-rate?token_id='+t)));
 if(rates.some(r=>!Number.isFinite(r.base_fee)||r.base_fee<0))throw Error('Unknown fees');
 const market={id:condition,catalogId:m.marketId,title:m.title,end:Date.parse(m.resolutionDate),status:'open',verified:true,negRisk:native.neg_risk,tokens,labels,fee:{mode:'reserve',curveRate:.07,notionalRate:Math.max(...rates.map(r=>r.base_fee/10000)),reportedBaseFee:rates.map(r=>r.base_fee)},url:m.url};
 const contract=parseContract(m.title,native.description||m.description,market.end);
 return {market,contract,evidence:{catalog:m,native,rates,verifiedAt:Date.now()}};
}
export async function discoverLab(api){
 const price=await api.get('/api/feeds/binance/fetchTicker',{symbol:'BTC/USDT'}),spot=ticker(price);
 const short=await api.get('/api/polymarket/fetchMarkets',{query:'Bitcoin',status:'active',sort:'closeDate',closeAfter:new Date(Date.now()+90000).toISOString(),limit:100});
 const long=await api.get('/api/polymarket/fetchMarkets',{query:'Bitcoin',status:'active',sort:'closeDate',closeAfter:new Date(Date.now()+9*3600000).toISOString(),limit:100});
 const chosen=[];
 for(const m of short.body.data.filter(m=>/^Bitcoin Up or Down/.test(m.title)&&Date.parse(m.resolutionDate)<Date.now()+25*60000)){
  if(chosen.filter(x=>x.universe==='ox').length>=2)break;
  try{chosen.push({...await identity(m),universe:'ox'});}catch(e){console.log(JSON.stringify({rejected:m.marketId,reason:e.message}));}
 }
 const candidates=long.body.data.map(m=>({m,c:parseContract(m.title,m.description,Date.parse(m.resolutionDate))})).filter(x=>x.c).sort((a,b)=>{const distance=x=>Math.min(Math.abs(spot.price-x.c.lower),x.c.upper===null?Infinity:Math.abs(spot.price-x.c.upper));return distance(a)-distance(b);});
 for(const {m} of candidates){
  if(chosen.filter(x=>x.universe==='coinman').length>=2)break;
  try{const v=await identity(m);if(v.contract)chosen.push({...v,universe:'coinman'});}catch(e){console.log(JSON.stringify({rejected:m.marketId,reason:e.message}));}
 }
 if(!chosen.some(x=>x.universe==='ox')||!chosen.some(x=>x.universe==='coinman'))throw Error('Both strategy universes must have verified markets');
 return {chosen,responses:{price,short,long}};
}
export async function collectLab({cycles=24,intervalMs=3000,runDir='runs/three-bot-forward'}={}){
 const frozen=verifyFrozen();fs.mkdirSync(runDir,{recursive:true});if(fs.existsSync(path.join(runDir,'snapshots.json')))throw Error('Use a fresh output directory for a new experiment');const release=acquire(path.join(runDir,'runner.lock'));
 const api=new ReadAPI(),snapshots=[],ticks=[],decisions=[],states={ox:freshState('ox'),coinman:freshState('coinman')};
 try{
  const discovery=await discoverLab(api);persist(path.join(runDir,'discovery.json'),discovery);persist(path.join(runDir,'frozen-rules.json'),frozen);
  const candleResponse=await api.get('/api/feeds/binance/fetchOHLCV',{symbol:'BTC/USDT',timeframe:'1h',limit:169});persist(path.join(runDir,'candles.json'),candleResponse);
  console.log(JSON.stringify({mode:'local-simulation',liveOrders:0,markets:discovery.chosen.map(x=>({universe:x.universe,title:x.market.title})),cycles}));
  for(let cycle=0;cycle<cycles;cycle++){
   const tickReply=await api.get('/api/feeds/binance/fetchTicker',{symbol:'BTC/USDT'}),tick=ticker(tickReply);ticks.push(tick);persist(path.join(runDir,'tickers.json'),ticks);
   for(const item of discovery.chosen){
    const replies=await Promise.all(item.market.tokens.map(outcomeId=>api.get('/api/polymarket/fetchOrderBook',{outcomeId,limit:20})));
    const s={id:item.market.id+':'+cycle,now:Date.now(),origin:'Predictefy live REST',universe:item.universe,market:item.market,contract:item.contract,reference:tick,referenceHistory:structuredClone(ticks),candles:candleResponse.body.data,receivedAt:replies.map(r=>r.receivedAt),books:replies.map((r,i)=>({token:item.market.tokens[i],timestamp:r.body.data.timestamp,source:r.body.data.provenance?.source,synthetic:r.body.data.sourceMetadata?.synthetic,bids:r.body.data.bids,asks:r.body.data.asks}))};
    const decision=strategyStep(states[item.universe],s);snapshots.push(s);decisions.push({universe:item.universe,...decision});persist(path.join(runDir,'snapshots.json'),snapshots);persist(path.join(runDir,'decisions.json'),decisions);persist(path.join(runDir,'ledgers.json'),states);
    console.log(JSON.stringify({cycle:cycle+1,strategy:item.universe,market:item.market.catalogId,asks:s.books.map(b=>b.asks[0]?.price),action:decision.action,reason:decision.reason,cash:states[item.universe].cash}));
   }
   persist(path.join(runDir,'usage.json'),api.usage);if(cycle<cycles-1)await wait(intervalMs);
  }
  const ox=evaluateStrategy('ox',snapshots.filter(s=>s.universe==='ox')),coinman=evaluateStrategy('coinman',snapshots.filter(s=>s.universe==='coinman')),priceOnly=evaluateStrategy('ox',snapshots.filter(s=>s.universe==='ox'),LAB,{priceOnly:true});
  const result={startedAt:snapshots[0].now,endedAt:snapshots.at(-1).now,snapshots:snapshots.length,usage:api.usage,ox:{report:ox.report,actions:ox.actions},coinman:{report:coinman.report,actions:coinman.actions},baselines:{noTrade:{realized:0,cash:1000},oxPriceOnly:{report:priceOnly.report,actions:priceOnly.actions}},liveOrders:0,settledMarkets:0};
  persist(path.join(runDir,'result.json'),result);console.log(JSON.stringify(result,null,2));return result;
 }finally{release();}
}
