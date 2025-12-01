const KEYWORDS = [
    { phrase: "cc0", weight: 0.4 },
    { phrase: "creative commons zero", weight: 0.4 },
    { phrase: "public domain", weight: 0.35 },
    { phrase: "no rights reserved", weight: 0.3 },
    { phrase: "open access", weight: 0.2 },
    { phrase: "copyright free", weight: 0.2 },
];
export function assessCc0(text, extraEvidence = []) {
    const haystack = text.toLowerCase();
    let score = 0;
    const evidence = [];
    for (const { phrase, weight } of KEYWORDS) {
        if (haystack.includes(phrase)) {
            score += weight;
            evidence.push(phrase);
        }
    }
    if (extraEvidence.length) {
        evidence.push(...extraEvidence);
        score += Math.min(extraEvidence.length * 0.05, 0.2);
    }
    score = Math.min(score, 1);
    return {
        isLikelyCc0: score >= 0.4,
        confidence: Number(score.toFixed(2)),
        evidence,
    };
}
