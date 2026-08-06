const https = require('https');
const fs = require('fs');
const path = require('path');

const urls = {
    'korea-university-seoul': 'https://korea.ac.kr/user/boardList.do?boardId=146&siteId=university&id=university_060101000000',
    'skku-university-insa': 'https://www.skku.edu/skku/campus/skk_comm/notice01.do',
    'konkuk-university-seoul': 'https://www.konkuk.ac.kr/do/MessageBoard/ArticleList.do?forum=notice',
    'cau-university-seoul': 'https://www.cau.ac.kr/cms/FR_CON/index.do?MENU_ID=100',
    'khu-university-seoul': 'https://www.khu.ac.kr/kor/notice/list.do'
};

const outputFile = path.join(__dirname, '..', 'reports', 'html-samples.json');
const results = {};

console.log('웹페이지 HTML 구조 수집을 시작합니다...');

let completed = 0;
const total = Object.keys(urls).length;

for (const [id, urlStr] of Object.entries(urls)) {
    https.get(urlStr, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            // HTML에서 body 부분만 대략적으로 추출하여 저장 (용량 최소화)
            const bodyMatch = data.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            results[id] = bodyMatch ? bodyMatch[1].substring(0, 50000) : data.substring(0, 50000);
            completed++;
            console.log(`[${completed}/${total}] ${id} 완료`);
            
            if (completed === total) {
                fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
                console.log(`\n수집이 완료되었습니다. 결과가 저장되었습니다: ${outputFile}`);
            }
        });
    }).on('error', (e) => {
        console.error(`오류 발생 (${id}):`, e.message);
        results[id] = `Error: ${e.message}`;
        completed++;
        if (completed === total) {
            fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
            console.log(`\n수집이 완료되었습니다. 결과가 저장되었습니다: ${outputFile}`);
        }
    });
}
