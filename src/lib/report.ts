import { dateOf, fromDay, monthOf, quarterOfMonth, quarterRange, shortDate, toDay, yearOf, type DayRange } from './dates';
import type { Settings, Tool, WorkRecord } from './types';
import { formatHours, safeFileName } from './util';
import { WORK_TYPES, WORK_TYPE_ORDER } from './workTypes';

/**
 * 전자결재 「분기별 업무결과물 보고서」 양식의 표를 칸 순서대로 채웁니다. Word 내보내기의 첫 쪽이 됩니다.
 * 기록이 모두 한 분기 안에 있으면 그 분기 보고서로 적고, 여러 분기에 걸치면 기록 날짜 범위로 적습니다.
 */

/** 칸 안의 한 줄. head 는 굵게 쓰고, muted 인 text 는 흐리게 씁니다(채울 값이 없을 때). */
export interface ReportLine {
  head?: string;
  text?: string;
  muted?: boolean;
  /** 앞 줄과 사이를 띄웁니다 */
  gap?: boolean;
}

export interface ReportRow {
  key: 'header' | 'tools' | 'outputs' | 'effects' | 'opinion' | 'attachments';
  label: string;
  /** 양식의 칸 이름 아래 작은 글씨. 칸이 좁아서 줄을 바꿀 자리(\n)를 정해 둡니다. */
  sub?: string;
  lines: ReportLine[];
}

export interface Report {
  /** 기록이 모두 한 분기 안에 있을 때 그 분기 */
  quarter: { year: number; quarter: number } | null;
  /** 보고 기간. 분기 보고서면 분기 전체, 아니면 첫 기록부터 마지막 기록까지 */
  range: DayRange;
  /** 기록 날짜로 정한 보고 분기: 2026년 3분기(7. 1.~9. 30.) 또는 2026. 9. 8.~10. 5. 고쳐 쓴 값을 찾는 열쇠이기도 합니다. */
  autoPeriodText: string;
  /** 문서에 쓰는 보고 분기. 고쳐 쓴 값이 있으면 그 값입니다. */
  periodText: string;
  /** 제목 아래 줄에 쓰는 짧은 꼴: 2026년 3분기 (고쳐 쓴 값이 있으면 그 값) */
  periodLabel: string;
  records: WorkRecord[];
  featured: WorkRecord[];
  rows: ReportRow[];
}

/** 양식은 대표 결과물 1~2건을 첨부합니다 */
export const FEATURED_LIMIT = 2;

export function recordsInQuarter(records: readonly WorkRecord[], year: number, quarter: number): WorkRecord[] {
  const range = quarterRange(year, quarter);
  return records
    .filter((r) => {
      const d = toDay(r.date);
      return d >= range.start && d <= range.end;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

export function toolNames(record: WorkRecord, settings: Settings): string[] {
  return record.toolIds.map((id) => settings.tools.find((t) => t.id === id)?.name).filter((n): n is string => !!n);
}

const oneLine = (text: string) => text.replace(/\s*\n+\s*/g, ' ').trim();
const toolHead = (tool: Tool) => [tool.name.trim(), tool.seat.trim()].filter(Boolean).join(' ');
/** 2026. 9. 8. (해를 빼면 9. 8.) */
const koDate = (iso: string, withYear: boolean) => `${withYear ? `${yearOf(iso)}. ` : ''}${monthOf(iso)}. ${dateOf(iso)}.`;

export function buildReport(records: readonly WorkRecord[], settings: Settings): Report {
  const list = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const first = list[0]?.date;
  const last = list[list.length - 1]?.date;
  const sameQuarter =
    !!first && !!last && yearOf(first) === yearOf(last) && quarterOfMonth(monthOf(first)) === quarterOfMonth(monthOf(last));
  const quarter = first && sameQuarter ? { year: yearOf(first), quarter: quarterOfMonth(monthOf(first)) } : null;

  let range: DayRange;
  let periodLabel: string;
  let periodText: string;
  if (quarter) {
    range = quarterRange(quarter.year, quarter.quarter);
    const m = (quarter.quarter - 1) * 3 + 1;
    periodLabel = `${quarter.year}년 ${quarter.quarter}분기`;
    periodText = `${periodLabel}(${m}. 1.~${m + 2}. ${dateOf(fromDay(range.end))}.)`;
  } else if (first && last) {
    range = { start: toDay(first), end: toDay(last) };
    periodLabel = first === last ? koDate(first, true) : `${koDate(first, true)}~${koDate(last, yearOf(first) !== yearOf(last))}`;
    periodText = periodLabel;
  } else {
    range = { start: 0, end: 0 };
    periodLabel = '[보고 분기]';
    periodText = periodLabel;
  }
  const autoPeriodText = periodText;
  const custom = settings.periods?.[autoPeriodText]?.trim();
  if (custom) {
    periodText = custom;
    periodLabel = custom;
  }

  const featured = list.filter((r) => r.featured);
  const team = settings.team.trim();
  const author = settings.author.trim();

  // 월별 주기. 분기 보고서는 석 달을 모두 적고, 그 밖에는 기록이 있는 달만 적습니다.
  const months: { year: number; month: number }[] = [];
  if (quarter) {
    const m = (quarter.quarter - 1) * 3 + 1;
    for (let i = 0; i < 3; i++) months.push({ year: quarter.year, month: m + i });
  } else {
    for (const r of list) {
      const y = yearOf(r.date);
      const m = monthOf(r.date);
      if (!months.some((x) => x.year === y && x.month === m)) months.push({ year: y, month: m });
    }
  }
  const manyYears = new Set(months.map((x) => x.year)).size > 1;
  const monthCounts = (rs: WorkRecord[]) =>
    months
      .map(({ year, month }) => {
        const n = rs.filter((r) => yearOf(r.date) === year && monthOf(r.date) === month).length;
        return { label: `${manyYears ? `${year}년 ` : ''}${month}월 ${n}건`, n };
      })
      .filter((x) => quarter || x.n > 0)
      .map((x) => x.label)
      .join(', ');

  // 부서, 작성자, 보고 분기
  const header: ReportLine[] = [{ text: `${team || '[부서]'}, ${author || '[작성자]'}, ${periodText}` }];

  // 사용 도구 / 좌석 등급
  const tools: ReportLine[] = settings.tools.map((tool) => {
    const count = list.filter((r) => r.toolIds.includes(tool.id)).length;
    const note = tool.note.trim();
    return { head: toolHead(tool), text: `${note ? `${note}, ` : ''}기록 ${count}건` };
  });
  const knownToolIds = new Set(settings.tools.map((t) => t.id));
  const noTool = list.filter((r) => !r.toolIds.some((id) => knownToolIds.has(id))).length;
  if (noTool) tools.push({ text: `도구를 고르지 않은 기록 ${noTool}건` });
  if (!tools.length) tools.push({ text: '[도구 이름과 좌석 등급, 사용자]', muted: true });

  // 주요 산출물: 유형별 건수와 월별 주기, 대표 결과물 번호
  const outputs: ReportLine[] = [];
  let n = 1;
  for (const type of WORK_TYPE_ORDER) {
    const rs = list.filter((r) => r.type === type);
    if (!rs.length) continue;
    outputs.push({ head: `${n}) ${WORK_TYPES[type].label} ${rs.length}건`, text: monthCounts(rs) });
    n += 1;
  }
  featured.forEach((r, i) => outputs.push({ head: `[첨부 ${i + 1}]`, text: `${r.title} (${shortDate(r.date)})`, gap: i === 0 }));
  if (list.length) {
    const weeks = Math.max(1, (range.end - range.start + 1) / 7);
    const days = new Set(list.map((r) => r.date)).size;
    outputs.push({ text: `전체 ${list.length}건, 기록한 날 ${days}일, 주 평균 ${formatHours(list.length / weeks)}건`, gap: true });
  } else {
    outputs.push({ text: '기록이 없어요.', muted: true });
  }

  // 활용 사례와 효과: 대표 결과물 먼저, 나머지는 최근 순. 양식 예시처럼 한계도 이 칸에 적습니다.
  const withEffect = [...featured, ...list.filter((r) => !r.featured).reverse()].filter((r) => r.effect.trim());
  const effects: ReportLine[] = withEffect.slice(0, 6).map((r) => ({ head: r.title, text: oneLine(r.effect) }));
  if (withEffect.length > 6) effects.push({ text: `그 밖에 효과를 적은 기록 ${withEffect.length - 6}건` });
  if (!withEffect.length) effects.push({ text: '[업무별로 이전 방식과 지금을 비교한 효과]', muted: true });
  const hits = list.filter((r) => r.limitHit);
  effects.push({
    head: '한계',
    text: hits.length ? `사용 한도 도달 ${hits.length}회(${hits.map((r) => shortDate(r.date)).join(', ')})` : '사용 한도에 도달한 기록 없음',
    gap: true,
  });

  // 부서장 의견: 부서장이 도구별로 적는 칸이라 자리만 만들어 둡니다
  const opinion: ReportLine[] = settings.tools.length
    ? settings.tools.map((tool) => ({ head: toolHead(tool), text: '[유지, 증설, 감축, 반납 중 하나와 사유]', muted: true }))
    : [{ text: '[도구별로 유지, 증설, 감축, 반납 중 하나와 사유]', muted: true }];

  // 첨부 결과물: 팀명_결과물명
  const teamForFile = safeFileName(team || '팀명', 20);
  const attachments: ReportLine[] = featured.length
    ? featured.map((r, i) => ({ head: `첨부 ${i + 1}. ${teamForFile}_${safeFileName(r.title)}`, text: oneLine(r.description) || r.title }))
    : [{ text: '대표 결과물로 지정한 기록이 없습니다.', muted: true }];

  const rows: ReportRow[] = [
    { key: 'header', label: '부서, 작성자, 보고 분기', lines: header },
    { key: 'tools', label: '사용 도구 / 좌석 등급', sub: '좌석 전부,\n사용자별', lines: tools },
    { key: 'outputs', label: '주요 산출물', sub: '건수, 사용처, 첨부 번호', lines: outputs },
    { key: 'effects', label: '활용 사례와 효과', sub: '업무별로 이전 → 지금', lines: effects },
    { key: 'opinion', label: '부서장 의견', sub: '도구별 유지, 증설,\n감축, 반납', lines: opinion },
    { key: 'attachments', label: '첨부 결과물 (1~2건)', lines: attachments },
  ];

  return { quarter, range, autoPeriodText, periodText, periodLabel, records: list, featured, rows };
}

/** 기획팀_2026년3분기_업무결과물보고서.docx */
export function reportFileName(report: Report, settings: Settings): string {
  const team = settings.team.trim() ? `${safeFileName(settings.team, 20)}_` : '';
  const stamp = (day: number) => fromDay(day).replaceAll('-', '');
  const period = report.quarter
    ? `${report.quarter.year}년${report.quarter.quarter}분기`
    : report.range.start === report.range.end
      ? stamp(report.range.start)
      : `${stamp(report.range.start)}-${stamp(report.range.end)}`;
  return `${team}${period}_업무결과물보고서.docx`;
}
