"use strict";

function paginate(items, page, pageSize) {
  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1), normalizedPageSize = Math.max(1, Math.min(50, Number.parseInt(pageSize, 10) || 10));
  return { items: items.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize), pagination: { page: normalizedPage, pageSize: normalizedPageSize, total: items.length, hasMore: normalizedPage * normalizedPageSize < items.length } };
}

function createUniversityNewsService({ repository, universities, config, sourceEntries = [] }) {
  const universityById = new Map(universities.map(university => [university.id, university]));
  return {
    getAll(options) { return paginate(repository.getAllNews(options), options.page, options.pageSize); },
    getByUniversityId(universityId, options) { const university = universityById.get(universityId); if (!university) return null; return { university: { id: university.id, name: university.name }, ...paginate(repository.getNewsByUniversityId(universityId, options), options.page, options.pageSize) }; },
    getByCategory(category, options) { return paginate(repository.getNewsByCategory(category, options), options.page, options.pageSize); },
    getStatus() { return { system:"UNI PICK University News System", phase:1, status:"setup", collectorEnabled:false, schedulerEnabled:false, aiEnabled:false, supportedCategories:config.enabledCategories.map(value=>({value,label:require("../utils/categoryUtils").getNewsCategoryLabel(value)})), registeredUniversityEntries:universities.length, registeredSourceCount:sourceEntries.length, activeSourceCount:0, storedNewsCount:repository.getAllNews({}).length, lastCollectionAt:null, lastSuccessfulCollectionAt:null }; },
  };
}

module.exports = { createUniversityNewsService };
