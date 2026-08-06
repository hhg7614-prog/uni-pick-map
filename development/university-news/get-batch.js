const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data', 'university-news-sources.final.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const unregistered = data.universities.filter(u => {
    // If verificationStatus is 'verified', skip
    if (u.verificationStatus === 'verified') return false;
    
    // Check if it has any 'verified: true' sources
    const hasVerifiedSource = Array.isArray(u.sources) && u.sources.some(s => s.verified === true);
    if (hasVerifiedSource) return false;
    
    return true;
});

const batch01 = unregistered.slice(0, 20);

fs.writeFileSync(path.join(__dirname, 'batch01.json'), JSON.stringify(batch01, null, 2), 'utf8');
