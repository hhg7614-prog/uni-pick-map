"use strict";

function validateRecommendations(results, data) {
  const universityById = new Map(data.universities.map((university) => [university.id, university]));
  const majorById = new Map(data.majors.map((major) => [major.id, major]));
  return results.map((result) => {
    const university = universityById.get(result.university?.id);
    if (!university) return null;
    const majors = (result.majors || []).filter((major) => majorById.get(major.id)?.universityId === university.id)
      .map((major) => ({ id: major.id, departmentName: major.departmentName, collegeName: major.collegeName, campusName: major.campusName, source: major.source, matchType: major.matchType }));
    return { university, majors, score: result.score };
  }).filter(Boolean);
}

module.exports = { validateRecommendations };
