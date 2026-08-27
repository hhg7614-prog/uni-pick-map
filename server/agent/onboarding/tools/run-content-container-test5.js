"use strict";
const fs=require("fs"),path=require("path");
const ROOT=path.resolve(__dirname,"../../../.."),OUT=path.join(ROOT,"server/agent/onboarding/reports/content-container-test5.json");
const TARGETS=[
 ["대구교육대학교","http://www.dnue.ac.kr/kor/CMS/Board/Board.do?mCode=MN168"],
 ["덕성여자대학교","https://www.duksung.ac.kr/bbs/board.do?bsIdx=35&menuId=1058"],
 ["동국대학교 WISE","https://wise.dongguk.ac.kr/article/establishnews/list"],
 ["경성대학교","https://kscms.ks.ac.kr/haksa/CMS/Board/Board.do?mCode=MN137&mode=list&mgr_seq=31"],
 ["경남대학교","https://inews.kyungnam.ac.kr/news/articleList.html?view_type=sm"]
];
const BLOCK=/학과소개|국어교육과|사회과교육과|총장인사말|역대총장|덕성소개|불교동아리|홍보영상|document\.location|window\.location|javascript:/i;
function clean(v){return String(v||"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim()}
function url(v,b){try{const raw=String(v||"").trim();if(/javascript:|document\.location|window\.location|%22/i.test(raw))return null;const u=new URL(raw,b);return /^https?:$/.test(u.protocol)?u.href:null}catch{return null}}
function links(html,base){const a=[],re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi;let m;while(m=re.exec(html)){const href=(m[1].match(/href\s*=\s*(["'])(.*?)\1/i)||[])[2],u=url(href,base),t=clean(m[2]);if(u&&t)a.push({url:u,title:t,detail:/action=view|mode=view|articleNo=|board_seq=|nttId=|\/view|\/detail/i.test(u)})}return a}
async function run([name,listUrl]){try{const r=await fetch(listUrl,{redirect:"follow",headers:{"User-Agent":"Mozilla/5.0 compatible UNI-PICK content container",Accept:"text/html"}}),html=await r.text(),all=links(html,r.url),details=[...new Map(all.filter(x=>x.detail&&!BLOCK.test(x.title)).map(x=>[x.url,x])).values()],bad=all.filter(x=>x.detail&&BLOCK.test(x.title)),result={name,listUrl,finalUrl:r.url,status:r.status,detailCandidates:details.slice(0,3),detailCount:details.length,blockedNavigationSamples:bad.slice(0,3),menuContamination:bad.length>0,decision:details.length>=3&&!bad.length?"CONTENT_CONTAINER_READY":"CONTENT_CONTAINER_REVIEW"};return result}catch(e){return{name,listUrl,decision:"NETWORK_OR_RUNTIME_REVIEW",errorName:e.name,errorMessage:e.message,stackFirstLine:String(e.stack||"").split("\n")[0]}}}
(async()=>{const items=[];for(const t of TARGETS)items.push(await run(t));const report={phase:"content_container_test5",processed:items.length,items,malformedJsRequests:items.flatMap(x=>(x.requests||[])).filter(x=>/document\.location|%22/i.test(x)).length,mutations:{source:false,store:false,preview:false,verified:false}};fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(report,null,2)+"\n","utf8");console.log(JSON.stringify(report,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
