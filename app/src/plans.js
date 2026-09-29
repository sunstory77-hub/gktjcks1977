// 요금제와 한도. 결제 연동 전에는 관리자 도구(admin.js)로 요금제·기간을 지정한다.
// AI 사용료는 고객 키로 AI 회사가 청구하므로(BYOK), 한도는 서버 자원(렌더)을 쓰는 캠페인 수·팀원 수로 둔다.
// 요금·한도 수치는 사업기획서 확정 전 초안 [확인 필요]
export const PLANS = {
  trial: { label: '무료 체험', days: 14, campaignsPerMonth: 3, members: 2 },
  basic: { label: '베이직', campaignsPerMonth: 30, members: 3 },
  pro: { label: '프로', campaignsPerMonth: 200, members: 10 },
};
export const PLAN_NAMES = Object.keys(PLANS);

export const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).toISOString();

// company: { plan, planUntil }, used: 이번 달 만든 캠페인 수, members: 현재 팀원 수
export function planStatus({ plan, planUntil }, used, members, at = new Date()) {
  const p = PLANS[plan] ?? PLANS.trial;
  const expired = Boolean(planUntil) && planUntil < at.toISOString();
  return {
    plan: PLANS[plan] ? plan : 'trial',
    label: p.label,
    until: planUntil ?? null,
    expired,
    campaigns: { used, limit: p.campaignsPerMonth },
    members: { used: members, limit: p.members },
  };
}
