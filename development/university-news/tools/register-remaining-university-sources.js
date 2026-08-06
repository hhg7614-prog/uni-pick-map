const fs = require('fs');
const path = require('path');

const UNIVERSITIES_JS_PATH = path.join(__dirname, '../../../../universities.js');
const SOURCES_JSON_PATH = path.join(__dirname, '../data/university-news-sources.final.json');

function getUniversities() {
  const content = fs.readFileSync(UNIVERSITIES_JS_PATH, 'utf8');
  // Match the array using regex
  const match = content.match(/const\s+universities\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    throw new Error('Could not parse universities.js');
  }
  return eval(match[1]);
}

function getSources() {
  if (fs.existsSync(SOURCES_JSON_PATH)) {
    return JSON.parse(fs.readFileSync(SOURCES_JSON_PATH, 'utf8'));
  }
  return { universities: [] };
}

function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  if (isDryRun) {
    console.log('[UNI PICK 공식 출처 등록 계획]\n');
    
    const universities = getUniversities();
    const sourcesData = getSources();
    
    console.log(`현재 대학 레코드: ${universities.length}`);
    
    const registeredSchools = sourcesData.universities.filter(u => {
       return u.verificationStatus === 'verified' || 
              u.verificationStatus === 'verified_source_pending_collection' ||
              (u.sources && u.sources.some(s => s.verified));
    });
    
    console.log(`기존 등록 완료: ${registeredSchools.length}`);
    
    const registeredIds = new Set(registeredSchools.map(u => u.universityId));
    const unregisteredSchools = universities.filter(u => !registeredIds.has(u.id));
    
    console.log(`미등록: ${unregisteredSchools.length}`);
    
    const batch1 = unregisteredSchools.slice(0, 20);
    console.log(`이번 배치: ${batch1.length}`);
    console.log('배치 번호: 01\n');
    
    console.log('조사 대상 학교:');
    batch1.forEach(school => {
      console.log(`- ${school.name}`);
    });
    
    console.log('\n[기존 등록 완료 41개 학교 목록 참고]');
    registeredSchools.forEach((school, index) => {
      console.log(`${index + 1}. ${school.universityName} ${school.campusName !== '본교' && school.campusName !== '캠퍼스' ? school.campusName : ''}`.trim());
    });

    console.log(`\n예상 URL 확인 수: ${batch1.length * 3}`);
    console.log(`예상 상세 링크 확인 수: ${batch1.length * 3}`);
    console.log('기존 41개 설정 수정: 아니오');
    console.log('사이트 UI 수정: 아니오');
  } else {
    console.log('현재는 --dry-run 옵션만 지원합니다.');
  }
}

main();
