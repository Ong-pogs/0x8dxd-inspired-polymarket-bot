import {loadKey} from './api.mjs';
const paths=new Set(['/api/polymarket/fetchMarkets','/api/polymarket/fetchOrderBook','/api/feeds/binance/fetchTicker','/api/feeds/binance/fetchOHLCV']);
export class ReadAPI{
 constructor({key=loadKey(),fetchImpl=fetch}={}){this.key=key;this.fetchImpl=fetchImpl;this.usage={requests:0,credits:0};}
 async get(path,params={}){
  if(!paths.has(path))throw Error('Read route not allowed');
  for(let attempt=0;attempt<3;attempt++){
   const requestedAt=Date.now(),response=await this.fetchImpl('https://data.predictefy.com'+path+'?'+new URLSearchParams(params),{method:'GET',headers:{Authorization:'Bearer '+this.key},redirect:'error',signal:AbortSignal.timeout(60000)}),body=await response.json(),credits=Number(response.headers.get('x-credits-charged')||0);
   this.usage.requests++;this.usage.credits+=credits;
   if((response.status===429||response.status>=500)&&attempt<2){await new Promise(ok=>setTimeout(ok,1000*(attempt+1)));continue;}
   if(!response.ok||body.success!==true)throw Error('Predictefy HTTP '+response.status+' '+(body.error?.code||'INVALID_RESPONSE'));
   return {requestedAt,receivedAt:Date.now(),path,params,credits,body};
  }
 }
}
export async function venue(url){const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Venue metadata HTTP '+r.status);return r.json();}
