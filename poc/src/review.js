// 광고 표현 검수: 근거 없는 최상급·보장·과장 표현과 회사 금지 표현을 찾아 경고한다.
// 차단이 아니라 경고다. 최종 판단과 책임은 광고주(사용자)에게 있다.
// 규칙은 일반적인 주의 표현 목록이며 법률 판단이 아니다. [기준: 2026-09 / 확인 필요 — 업종별 규정은 법률 자문으로 보완]

export const AD_RULES = [
  { re: /최고|최상|최강|넘버\s?원|No\.?\s?1|1위|1등|업계\s?최초|국내\s?최초|세계\s?최초|유일(?:한|무이)?|독보적/i, reason: '최상급·유일 표현 — 객관적 근거(출처)가 있을 때만 사용', level: 'high' },
  { re: /100\s?%|백\s?퍼센트|무조건|반드시|틀림없이|완벽(?:한|하게)?/, reason: '단정·완전 표현 — 결과를 보장하는 것처럼 읽힘', level: 'high' },
  { re: /(?:합격|취업|수익|매출|성적|효과|만족)\s?(?:을\s?)?(?:보장|보증|약속)/, reason: '성과 보장 표현 — 실제로 보장하지 않으면 과장 광고 위험', level: 'high', group: 'guarantee' },
  { re: /보장|보증/, reason: '보장 표현 — 무엇을 어떻게 보장하는지 명시 필요', level: 'medium', group: 'guarantee' },
  { re: /\d+\s?배\s?(?:빠르|높|늘|증가|향상|성장)/, reason: '수치 비교 효과 표현 — 근거 자료 필요', level: 'medium' },
  { re: /(?:타사|경쟁사|다른\s?(?:강의|업체|제품)).{0,10}(?:보다|와\s?달리|대비)/, reason: '비교 광고 — 객관적 비교 근거 필요, 비방 금지', level: 'medium' },
  { re: /(?:오늘|지금)만|마감\s?임박|선착순\s?\d+|단\s?\d+\s?(?:명|자리)/, reason: '긴급·희소성 표현 — 실제 조건과 일치해야 함', level: 'low' },
];

// entries: [[위치, 텍스트], ...] → [{ word, where, reason, level }]
export function reviewTexts(entries, { forbidden = [] } = {}) {
  const hits = new Map();
  const add = (word, where, reason, level) => {
    const key = `${word}|${reason}`;
    const h = hits.get(key) ?? { word, where: [], reason, level };
    if (!h.where.includes(where)) h.where.push(where);
    hits.set(key, h);
  };
  for (const [where, text] of entries) {
    const t = String(text ?? '');
    if (!t) continue;
    const groups = new Set(); // 같은 묶음은 더 구체적인(앞쪽) 규칙 하나만
    for (const rule of AD_RULES) {
      if (rule.group && groups.has(rule.group)) continue;
      const m = rule.re.exec(t);
      if (!m) continue;
      add(m[0], where, rule.reason, rule.level);
      if (rule.group) groups.add(rule.group);
    }
    for (const word of forbidden) if (word && t.includes(word)) add(word, where, '회사 금지 표현', 'high');
  }
  const order = { high: 0, medium: 1, low: 2 };
  return [...hits.values()].sort((a, b) => order[a.level] - order[b.level]);
}

export const formatHit = (h) => `[${{ high: '주의', medium: '확인', low: '참고' }[h.level]}] "${h.word}" — ${h.reason} (${h.where.join(', ')})`;
