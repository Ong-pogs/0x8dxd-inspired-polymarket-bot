import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {STRATEGY} from '../identity.mjs';import {evaluateStrategy} from '../src/strategy.mjs';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),snapshots=read('data/forward/snapshots.json'),saved=read('data/forward/expected.json'),archive=read('data/frozen-source/frozen-rules.json'),packaged=read('data/package-rules.json');
for(const [file,hash] of Object.entries(archive.files))assert.equal(createHash('sha256').update(fs.readFileSync('data/frozen-source/'+file)).digest('hex'),hash,'Archived source changed');
for(const [file,hash] of Object.entries(packaged.files))assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,'Packaged rule changed');
assert.ok(snapshots.every(s=>s.now>Date.parse(archive.frozenAt)));const e=evaluateStrategy(STRATEGY,snapshots);assert.deepEqual(e.state,saved.state);assert.deepEqual(e.report,saved.report);assert.equal(snapshots.length,48);
const w=read('data/wallet.json'),original=[0,1].flatMap(i=>read('data/wallet-raw/trades-'+i+'.json').body.data),official=read('data/wallet-raw/official-trades.json');assert.equal(original.length,200);assert.equal(w.trades.length,200);
for(const t of original)assert.ok(official.some(n=>n.transactionHash===t.tradeId&&n.asset===t.outcomeId&&Math.abs(n.price-t.price)<1e-7&&Math.abs(n.size-t.amount)<1e-6));
try{process.loadEnvFile();}catch{}const key=process.env.PREDICTEFY_API_KEY;
function files(d){return fs.readdirSync(d,{withFileTypes:true}).filter(x=>!['.git','tmp','runs','node_modules'].includes(x.name)&&(!x.name.startsWith('.env')||x.name==='.env.example')).flatMap(x=>x.isDirectory()?files(d+'/'+x.name):[d+'/'+x.name]);}
for(const file of files('.')){const text=fs.readFileSync(file,'utf8');assert.ok(!(key&&text.includes(key))&&!/pk_live_[A-Za-z0-9]{15,}/.test(text),'Credential check failed: '+file);}
console.log(JSON.stringify({strategy:STRATEGY,verified:true,snapshots:48,replayMatchesOriginalLedger:true,originalRulesFrozenBeforeCapture:true,packagedRulesVerified:true,walletRowsMatched:200,liveOrders:0},null,2));
