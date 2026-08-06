"use strict";

const { normalizeNewsCategory } = require("../utils/categoryUtils");

function handleUniversityNewsRoute(pathname, query, service) {
  const options={ category:normalizeNewsCategory(query.get("category")), page:query.get("page"), pageSize:query.get("pageSize"), sort:query.get("sort") || "publishedAt" };
  if (pathname === "/api/news") {
    if (options.category === null) return { status:400,payload:{error:"Invalid news category"} };
    if (query.get("universityId")) {
      const universityId = query.get("universityId");
      const result = service.getByUniversityId(universityId, options);
      return result ? { status:200, payload:{ ...result, filters:{category:options.category||"all",universityId}, lastUpdatedAt:null } } : { status:404, payload:{error:"University not found"} };
    }
    const result=service.getAll(options);
    return {status:200,payload:{...result,filters:{category:options.category||"all",universityId:null},lastUpdatedAt:null}};
  }
  if (pathname === "/api/news/status") return { status:200,payload:service.getStatus() };
  const universityMatch=pathname.match(/^\/api\/universities\/([^/]+)\/news$/);
  if (universityMatch) { if(options.category===null)return{status:400,payload:{error:"Invalid news category"}};const result=service.getByUniversityId(decodeURIComponent(universityMatch[1]),options);return result?{status:200,payload:{...result,lastUpdatedAt:null}}:{status:404,payload:{error:"University not found"}}; }
  const categoryMatch=pathname.match(/^\/api\/news\/categories\/([^/]+)$/);
  if(categoryMatch){const category=normalizeNewsCategory(decodeURIComponent(categoryMatch[1]));if(!category||category==="all")return{status:400,payload:{error:"Invalid news category"}};const result=service.getByCategory(category,options);return{status:200,payload:{...result,filters:{category,universityId:null},lastUpdatedAt:null}};}
  return null;
}

module.exports = { handleUniversityNewsRoute };
