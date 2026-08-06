"use strict";
// Builds a source-status registry for every existing university record.  It
// does not make network requests and never enables a source automatically.
const fs=require("fs"),path=require("path"),vm=require("vm");
const ROOT=path.resolve(__dirname,".."); const DATA=path.join(ROOT,"data"); const REPORTS=path.join(ROOT,"reports");
const UNIVERSITIES=path.resolve(ROOT,"..","..","universities.js"); const PHASE10=path.join(DATA,"university-news-sources.phase-10.json");
const OVERRIDES=path.join(DATA,"university-news-sources.final.overrides.json");
function write(file,v){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(v,null,2)+"\n","utf8")}
function loadUniversities(){let code=fs.readFileSync(UNIVERSITIES,"utf8").replace("const universities =","const universities = globalThis.UNIS =");const ctx={globalThis:{},console:{log(){}}};ctx.window=ctx.globalThis;vm.createContext(ctx);vm.runInContext(code,ctx);return ctx.globalThis.UNIS||[]}
function main(){
  const records=loadUniversities(); const phase10=JSON.parse(fs.readFileSync(PHASE10,"utf8"));
  const entries=[...phase10.universities,...(fs.existsSync(OVERRIDES)?JSON.parse(fs.readFileSync(OVERRIDES,"utf8")):[])];
  const knownById=new Map(entries.map(x=>[x.universityId,x]));
  const knownByGroup=new Map(entries.filter(x=>x.universityGroupId).map(x=>[x.universityGroupId,x]));
  const output=records.map(u=>{ const groupId=u.universityGroupId||u.id; const x=knownById.get(u.id)||knownByGroup.get(groupId); return {universityId:u.id,universityGroupId:groupId,universityName:u.name,campusName:u.campusName||"",enabled:false,verificationStatus:x?.verificationStatus||"pending",healthStatus:x?.healthStatus||"unknown",sources:x?.sources||[],searchKeywords:[u.name,u.shortName].filter(Boolean),lastCheckedAt:null,lastSuccessfulCollectionAt:null,coverage:{schoolNews:Boolean(x?.sources?.some(s=>s.category==="school_news"&&s.verified)),schoolNotice:Boolean(x?.sources?.some(s=>s.category==="school_notice"&&s.verified)),schoolEvent:Boolean(x?.sources?.some(s=>s.category==="school_event"&&s.verified)),mediaNews:false}}; });
  const configured=output.filter(x=>x.sources.length);
  const unresolved=output.filter(x=>!x.sources.length).map(x=>({universityId:x.universityId,universityGroupId:x.universityGroupId,universityName:x.universityName,campusName:x.campusName,reason:"공식 출처 URL과 목록 구조를 아직 검증하지 않았습니다.",verificationStatus:x.verificationStatus,manualAction:"공식 대학 도메인·robots.txt·목록 페이지·상세 링크를 확인한 뒤 출처를 등록하세요."}));
  const final={generatedAt:new Date().toISOString(),totalUniversityRecords:output.length,automaticScheduleEnabled:false,universities:output}; write(path.join(DATA,"university-news-sources.final.json"),final);
  const coverage={generatedAt:final.generatedAt,totalUniversityRecords:output.length,configuredUniversities:configured.length,verifiedUniversities:0,partiallyVerifiedUniversities:0,unresolvedUniversities:unresolved.length,coverage:{schoolNews:output.filter(x=>x.coverage.schoolNews).length,schoolNotice:output.filter(x=>x.coverage.schoolNotice).length,schoolEvent:output.filter(x=>x.coverage.schoolEvent).length,mediaNews:0},sources:{total:configured.reduce((n,x)=>n+x.sources.length,0),healthy:0,warning:0,failing:0,disabled:0,unknown:configured.reduce((n,x)=>n+x.sources.length,0)},detailLinks:{verified:0,reviewRequired:0,mismatch:0,homepageRejected:0,listPageRejected:0,missing:0},errors:[]};
  write(path.join(REPORTS,"final-247-university-coverage.json"),coverage); write(path.join(REPORTS,"final-unresolved-universities.json"),unresolved);
  write(path.join(REPORTS,"final-source-health.json"),configured.flatMap(x=>x.sources.map(s=>({universityId:x.universityId,universityName:x.universityName,sourceId:s.id,sourceUrl:s.listUrl||s.rssUrl||"",healthStatus:"unknown",reason:"최종 247개 검증 전에는 자동 수집을 활성화하지 않습니다."}))));
  write(path.join(REPORTS,"final-detail-link-validation.json"),[]); fs.writeFileSync(path.join(REPORTS,"final-247-university-coverage.md"),`# UNI PICK 전국 대학 소식 커버리지 보고서\n\n- 실제 대학/캠퍼스 레코드: ${coverage.totalUniversityRecords}\n- 출처가 등록된 레코드: ${coverage.configuredUniversities}\n- 출처 확인 대기 레코드: ${coverage.unresolvedUniversities}\n- 자동 스케줄: 비활성화\n\n미확인 URL·상세 게시물 링크는 생성하지 않았습니다.\n`,"utf8"); console.log(JSON.stringify(coverage,null,2));
}
main();
