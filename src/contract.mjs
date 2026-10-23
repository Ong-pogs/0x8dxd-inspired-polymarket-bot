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
