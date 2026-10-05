import type { WorkRecord } from '../lib/types';

/** 머리말과 지금 보는 기간의 숫자 요약 */
export function Heading({ records }: { records: WorkRecord[] }) {
  const days = new Set(records.map((r) => r.date)).size;
  return (
    <section className="heading">
      <div>
        <div className="eyebrow">LESS REPORTING, MORE MAKING</div>
        <h1>작업의 흔적을 한눈에.</h1>
        <p>기간을 고르고, 쌓인 기록에서 결과물을 찾아보세요.</p>
      </div>
      <dl className="stats">
        <div>
          <dt>남긴 기록</dt>
          <dd>
            <span>{records.length}</span>
            <small>개</small>
          </dd>
        </div>
        <div>
          <dt>활용한 날</dt>
          <dd>
            <span>{days}</span>
            <small>일</small>
          </dd>
        </div>
      </dl>
    </section>
  );
}
