"use strict";

const fs = require("fs"), path = require("path");
const { htmlListCollector, findBySelector, textOf } = require("../../../../development/university-news/collectors/html-list-collector");
const { getAllItems, saveNewItems, STORE_PATH, PREVIEW_PATH } = require("../../store");
const { filterNewItems } = require("../../dedup");

const ROOT = path.resolve(__dirname, "../../../..");
const CATALOG = path.join(ROOT, "development/university-news/data/university-news-sources.final.json");
const UNIVERSITY_ID = "kyungnam-university-본교";
const SOURCE_ID = "kyungnam-university-general-feed";
const SOURCE_URL = "https://www.kyungnam.ac.kr/ko/8443/subview.do";
const REPORT = path.join(ROOT, "server/agent/onboarding/reports/kyungnam-university-activation.json");
const QUEUE = path.join(ROOT, "server/agent/onboarding/data/activation-ready-queue.json");
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); JSON.parse(fs.readFileSync(tmp, "utf8")); fs.renameSync(tmp, file); }
function clean(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&amp;/gi, " ").replace(/\s+/g, " ").trim(); }
function titleMatches(a, b) { const x=clean(a).replace(/^(?:NEW|N|새글)\s*/i, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(), y=clean(b).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); return Boolean(x && y && (x === y || x.includes(y) || y.includes(x))); }
function official(url) { try { return new URL(url).hostname.replace(/^www\./, "") === "kyungnam.ac.kr"; } catch { return false; } }
function contentCategory(title) { return /수강|학사|방학|수업/u.test(clean(title)) ? "ACADEMIC" : "OTHER"; }
function backup() { const dir=path.join(ROOT,"server/agent/onboarding/backups",`kyungnam-activation-${new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14)}`); fs.mkdirSync(dir,{recursive:true}); for(const f of [CATALOG,STORE_PATH,PREVIEW_PATH]) fs.copyFileSync(f,path.join(dir,path.basename(f))); return dir; }
async function main() {
  const catalog=read(CATALOG), university=catalog.universities.find(u=>u.universityId===UNIVERSITY_ID);
  if(!university) throw new Error("university_not_found");
  if((university.sources||[]).some(s=>s.id===SOURCE_ID || (s.verified && s.listUrl===SOURCE_URL))) throw new Error("source_already_exists");
  const before={verified:catalog.universities.flatMap(u=>u.sources||[]).filter(s=>s.verified).length,store:getAllItems().length,preview:read(PREVIEW_PATH).items.length};
  const source={id:SOURCE_ID,name:"경남대학교 최신 학사 안내",sourceScope:"GENERAL_UNIVERSITY_FEED",category:"school_news",categoryLabel:"학교 소식",sourceType:"official",collectionType:"html",listUrl:SOURCE_URL,selectors:{item:"tbody tr.notice",title:"td.td-subject strong",link:"td.td-subject a",date:"td.td-date"},detailSelectors:{title:"h2.view-title"},datePolicy:{prefer:"list_row_date"},verified:false,enabled:false,status:"collector_config_candidate",healthStatus:"unknown"};
  const collected=await htmlListCollector({university,source,limit:3}); const accepted=[];
  for(const item of collected.items||[]){const r=await fetch(item.sourceUrl,{redirect:"follow",headers:{"User-Agent":"Mozilla/5.0 compatible UNI-PICK validator",Accept:"text/html,application/xhtml+xml"}}),html=await r.text(),detailTitle=textOf(findBySelector(html,source.detailSelectors.title)[0]); if(r.ok&&official(r.url)&&item.title&&item.publishedAt&&titleMatches(item.title,detailTitle)) accepted.push({...item,title:clean(item.title).replace(/\s*새글\s*$/,""),sourceUrl:r.url,sourceId:SOURCE_ID,sourceName:source.name,sourceSiteUrl:SOURCE_URL,contentCategory:contentCategory(item.title),detailValidation:{verified:true,sourceTitle:detailTitle,dateProvenance:"list_row_date"}});}
  if(collected.status!=="success"||collected.items.length<3||accepted.length<2||accepted.some(x=>!x.publishedAt)) throw new Error("production_collection_validation_failed");
  const {newItems,duplicateCount}=filterNewItems(accepted,getAllItems()); if(newItems.length<2) throw new Error("insufficient_new_items");
  const backupDir=backup(); university.sources.push({...source,verified:true,enabled:true,status:"verified",healthStatus:"healthy"}); write(CATALOG,catalog); saveNewItems(newItems);
  if(fs.existsSync(QUEUE)){const queue=read(QUEUE); queue.items=(queue.items||[]).map(x=>x.universityId===UNIVERSITY_ID?{...x,status:"ACTIVATED_SUCCESS",activatedAt:new Date().toISOString()}:x); write(QUEUE,queue);}
  const after={verified:catalog.universities.flatMap(u=>u.sources||[]).filter(s=>s.verified).length,store:getAllItems().length,preview:read(PREVIEW_PATH).items.length}; const previewCount=read(PREVIEW_PATH).items.filter(x=>x.universityId===UNIVERSITY_ID).length;
  const result={phase:"kyungnam_general_university_feed_activation",status:"ACTIVATED_SUCCESS",universityId:UNIVERSITY_ID,sourceId:SOURCE_ID,sourceUrl:SOURCE_URL,sourceScope:"GENERAL_UNIVERSITY_FEED",accepted:accepted.length,newItems:newItems.length,duplicateCount,publishedAt:accepted.map(x=>x.publishedAt),titles:accepted.map(x=>x.title),contentCategories:accepted.map(x=>x.contentCategory),publishedAtNull:accepted.filter(x=>!x.publishedAt).length,before,after,previewCount,previewVisibility:previewCount?"VISIBLE":"PREVIEW_NOT_VISIBLE",backupDir}; write(REPORT,result); console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1});
