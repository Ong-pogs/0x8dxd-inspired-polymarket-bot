import fs from 'node:fs';
export function loadKey(){try{process.loadEnvFile();}catch{} const k=process.env.PREDICTEFY_API_KEY;if(!k)throw Error('Set PREDICTEFY_API_KEY in .env');return k;}
export class Predictefy {
  constructor({key=loadKey(),fetchImpl=fetch}={}){this.key=key;this.fetchImpl=fetchImpl;this.usage={requests:0,credits:0};}
  async get(verb,params={}) {
    if(!['fetchMarkets','fetchMarket','fetchOrderBook','fetchTrades','has'].includes(verb))throw Error('Read route not allowed');
    const path='/api/polymarket/'+verb+'?'+new URLSearchParams(params);
    for(let attempt=0;attempt<3;attempt++){
      const started=Date.now();
      const r=await this.fetchImpl('https://data.predictefy.com'+path,{method:'GET',headers:{Authorization:'Bearer '+this.key},redirect:'error',signal:AbortSignal.timeout(60000)});
      const body=await r.json(); const credits=Number(r.headers.get('x-credits-charged')||0);this.usage.requests++;this.usage.credits+=credits;
      if((r.status===429||r.status>=500)&&attempt<2){await new Promise(ok=>setTimeout(ok,Math.max(1000,Number(r.headers.get('retry-after')||attempt+1)*1000)));continue;}
      if(!r.ok||body.success!==true)throw Error('Predictefy HTTP '+r.status+' '+(body.error?.code||'INVALID_RESPONSE'));
      return {receivedAt:Date.now(),requestedAt:started,path,credits,body};
    }
  }
}
export function save(file,value){fs.mkdirSync(new URL('.',new URL('file:///'+file.replaceAll('\\','/'))),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2));}
