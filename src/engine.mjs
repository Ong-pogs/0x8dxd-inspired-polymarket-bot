import {createHash} from 'node:crypto';
export const CONFIG=Object.freeze({bankroll:1000,shares:10,seedMax:.40,minEdge:.015,slippage:.01,participation:.25,maxAgeMs:5000,maxSkewMs:2000,futureMs:500,unmatchedMs:30000,maxUnmatchedCost:10,marketBudget:200,minRemainingMs:45000});
export const round=n=>Math.round((n+Number.EPSILON)*1e6)/1e6;
const ceil4=n=>Math.ceil((n-1e-12)*10000)/10000;
export function feeReserve(q,p,fee){
  if(!fee||fee.mode!=='reserve'||!Number.isFinite(fee.curveRate)||fee.curveRate<0||!Number.isFinite(fee.notionalRate)||fee.notionalRate<0)throw Error('Unverified fee policy');
  return ceil4(Math.max(q*fee.curveRate*p*(1-p),q*p*fee.notionalRate));
}
export function validate(s,c=CONFIG){
  if(!s||!Number.isFinite(s.now)||!s.market||!s.books)return 'INVALID_SNAPSHOT';
  const m=s.market;
  if(m.status!=='open'||!Number.isFinite(m.end)||s.now>=m.end)return 'MARKET_CLOSED';
  if(m.verified!==true||m.negRisk!==false||!Array.isArray(m.tokens)||m.tokens.length!==2||new Set(m.tokens).size!==2)return 'IDENTITY_UNVERIFIED';
  try{feeReserve(1,.5,m.fee);}catch{return 'FEE_UNVERIFIED';}
  if(s.books.length!==2)return 'MISSING_BOOK';
  for(let i=0;i<2;i++){
    const b=s.books[i];
    if(!b||b.token!==m.tokens[i])return 'TOKEN_MISMATCH';
    if(b.synthetic!==false||!['venue-rest','predictefy-live','fixture'].includes(b.source))return 'SYNTHETIC_OR_UNKNOWN_BOOK';
    if(!Number.isFinite(b.timestamp)||s.now-b.timestamp>c.maxAgeMs)return 'STALE_BOOK';
    if(b.timestamp>s.now+c.futureMs)return 'FUTURE_BOOK';
    if(!Array.isArray(b.asks)||!Array.isArray(b.bids)||[...b.asks,...b.bids].some(l=>!Number.isFinite(l.price)||l.price<=0||l.price>=1||!Number.isFinite(l.size)||l.size<0))return 'INVALID_LEVEL';
    const ask=Math.min(...b.asks.filter(l=>l.size>0).map(l=>l.price)),bid=Math.max(...b.bids.filter(l=>l.size>0).map(l=>l.price));
    if(bid>=ask)return 'CROSSED_BOOK';
  }
  if(Math.abs(s.books[0].timestamp-s.books[1].timestamp)>c.maxSkewMs)return 'BOOK_SKEW';
  return null;
}
export function quote(book,side,requested,fee,c=CONFIG,limit=side==='buy'?1:0){
  let left=requested;const fills=[];
  const levels=[...(side==='buy'?book.asks:book.bids)].sort((a,b)=>side==='buy'?a.price-b.price:b.price-a.price);
  for(const l of levels){
    const price=round(side==='buy'?Math.min(.999999,l.price+c.slippage):Math.max(.000001,l.price-c.slippage));
    if(side==='buy'?price>limit:price<limit)break;
    const size=Math.floor(Math.min(left,l.size*c.participation)*1e6)/1e6;
    if(size<=0)continue;
    const reserve=feeReserve(size,price,fee);fills.push({size,price,fee:reserve,bookPrice:l.price});left=round(left-size);if(left<=1e-6)break;
  }
  const shares=round(fills.reduce((v,x)=>v+x.size,0)),gross=round(fills.reduce((v,x)=>v+x.size*x.price,0)),fees=round(fills.reduce((v,x)=>v+x.fee,0));
  return {side,requested,shares,gross,fees,total:round(side==='buy'?gross+fees:gross-fees),vwap:shares?gross/shares:null,fills};
}
