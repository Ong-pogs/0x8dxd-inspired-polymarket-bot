import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {STRATEGY} from '../identity.mjs';import {ReadAPI,venue} from './read-api.mjs';import {LAB,evaluateStrategy,freshState,strategyStep} from './strategy.mjs';import {parseContract} from './contract.mjs';import {persist,acquire} from './store.mjs';
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
export async function collect({cycles=24,interval=3000,dir='runs/new-capture'}={}){
 const rules=JSON.parse(fs.readFileSync('data/package-rules.json','utf8'));for(const [f,h] of Object.entries(rules.files))if(createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==h)throw Error('Packaged rules changed: '+f);
 fs.mkdirSync(dir,{recursive:true});if(fs.existsSync(path.join(dir,'snapshots.json')))throw Error('Choose a fresh output directory');const release=acquire(path.join(dir,'runner.lock')),api=new ReadAPI();
 try{
  const catalog=await api.get('/api/polymarket/fetchMarkets',{query:'Bitcoin',status:'active',sort:'closeDate',closeAfter:new Date(Date.now()+(STRATEGY==='coinman'?9*3600000:90000)).toISOString(),limit:100});
  const selected=[];
  for(const m of catalog.body.data){
   const end=Date.parse(m.resolutionDate),contract=parseContract(m.title,m.description,end);
   if(STRATEGY==='ox'&&(!/^Bitcoin Up or Down/.test(m.title)||end>Date.now()+25*60000)||STRATEGY==='coinman'&&!contract)continue;
   const id=m.sourceMetadata?.nativeMarketId;if(!/^0x[a-f\d]{64}$/i.test(id||''))continue;
   const n=await venue('https://clob.polymarket.com/markets/'+id),labels=STRATEGY==='ox'?['Up','Down']:['Yes','No'];
   if(n.condition_id!==id||!n.active||n.closed||!n.accepting_orders||n.tokens?.length!==2||typeof n.neg_risk!=='boolean')continue;
   const tokens=labels.map(l=>n.tokens.find(t=>t.outcome===l)?.token_id);if(tokens.some(t=>!t||!m.outcomes.some(o=>String(o.outcomeId)===t))||new Set(tokens).size!==2)continue;
   const rates=await Promise.all(tokens.map(t=>venue('https://clob.polymarket.com/fee-rate?token_id='+t)));if(rates.some(r=>!Number.isFinite(r.base_fee)||r.base_fee<0))continue;
   const verifiedContract=STRATEGY==='coinman'?parseContract(m.title,n.description||m.description,end):null;if(STRATEGY==='coinman'&&!verifiedContract)continue;
   selected.push({market:{id,catalogId:m.marketId,title:m.title,status:'open',end,verified:true,negRisk:n.neg_risk,tokens,labels,fee:{mode:'reserve',curveRate:.07,notionalRate:Math.max(...rates.map(r=>r.base_fee/10000)),reportedBaseFee:rates.map(r=>r.base_fee)}},contract:verifiedContract,evidence:{catalog:m,native:n,rates}});if(selected.length===2)break;
  }
  if(!selected.length)throw Error('No supported, verified active market in this catalog window');persist(path.join(dir,'discovery.json'),selected);persist(path.join(dir,'rules.json'),rules);
  const candles=STRATEGY==='coinman'?(await api.get('/api/feeds/binance/fetchOHLCV',{symbol:'BTC/USDT',timeframe:'1h',limit:169})).body.data:[],history=[],snapshots=[],state=freshState(STRATEGY);
  for(let cycle=0;cycle<cycles;cycle++){
   const reply=await api.get('/api/feeds/binance/fetchTicker',{symbol:'BTC/USDT'}),d=reply.body.data,reference={symbol:d.symbol,price:d.last??d.close,timestamp:d.timestamp,source:d.provenance?.source,receivedAt:reply.receivedAt};history.push(reference);
   for(const item of selected){const replies=await Promise.all(item.market.tokens.map(outcomeId=>api.get('/api/polymarket/fetchOrderBook',{outcomeId,limit:20}))),s={id:item.market.id+':'+cycle,now:Date.now(),origin:'Predictefy live REST',universe:STRATEGY,market:item.market,contract:item.contract,reference,referenceHistory:structuredClone(history),candles,receivedAt:replies.map(r=>r.receivedAt),books:replies.map((r,i)=>({token:item.market.tokens[i],timestamp:r.body.data.timestamp,source:r.body.data.provenance?.source,synthetic:r.body.data.sourceMetadata?.synthetic,bids:r.body.data.bids,asks:r.body.data.asks}))};const e=strategyStep(state,s);snapshots.push(s);persist(path.join(dir,'snapshots.json'),snapshots);persist(path.join(dir,'ledger.json'),state);console.log(JSON.stringify({cycle:cycle+1,market:item.market.catalogId,action:e.action,reason:e.reason,cash:state.cash}));}
   if(cycle<cycles-1)await wait(interval);
  }
  const e=evaluateStrategy(STRATEGY,snapshots);persist(path.join(dir,'result.json'),{strategy:STRATEGY,actions:e.actions,report:e.report,snapshots:e.snapshotCount,usage:api.usage,liveOrders:0});console.log(JSON.stringify({snapshots:e.snapshotCount,actions:e.actions,report:e.report,usage:api.usage,liveOrders:0},null,2));
 }finally{release();}
}
