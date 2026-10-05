/** 작업 유형. 타임라인 점 색과 목록 칩 색을 정합니다. */
export type WorkType = 'dev' | 'doc' | 'design' | 'etc';

/** 기록에 붙은 증빙 이미지의 참조. 실제 파일은 데이터 폴더의 기록 폴더 안에 있습니다. */
export interface ImageRef {
  id: string;
  label: string;
  /** 처음 넣을 때의 파일 이름 */
  name: string;
  /** 기록 폴더 안 파일 이름(1.png 등). 저장 서버가 저장할 때 정하므로 새로 넣는 이미지에는 없습니다. */
  file?: string;
}

/** 기록 1건 */
export interface WorkRecord {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  type: WorkType;
  /** 사용한 도구(좌석) id 목록. 설정의 tools 를 가리킵니다. */
  toolIds: string[];
  title: string;
  /** 작업 내용: 무엇을 했고 도구를 어떻게 썼는지 */
  description: string;
  /** 효과와 메모: 이전 방식과 비교, 한계 */
  effect: string;
  /** 이 작업 중에 사용 한도에 도달했는지 */
  limitHit: boolean;
  images: ImageRef[];
  /** 예시 데이터 여부. 설정이나 상단 버튼으로 한 번에 지울 수 있습니다. */
  sample: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 팀이 쓰는 도구(좌석). 보고서의 「사용 도구 / 좌석 등급」 칸을 만듭니다. */
export interface Tool {
  id: string;
  name: string;
  /** 좌석 등급. 예: Premium */
  seat: string;
  /** 좌석 수, 사용자, 부여일 같은 메모 */
  note: string;
}

/** 보고서 표에서 내보내기 창이 고쳐 쓰게 하는 칸 */
export type ReportField = 'tools' | 'outputs' | 'effects' | 'opinion' | 'attachments';

export interface Settings {
  team: string;
  author: string;
  tools: Tool[];
  /**
   * 내보내기 창에서 보고 분기 칸을 고쳐 쓴 값. 기록 날짜로 정한 기간 글(예: 2026년 3분기(7. 1.~9. 30.))을 열쇠로 둬서
   * 같은 기간을 다시 내보낼 때만 불러옵니다.
   */
  periods?: Record<string, string>;
  /** 내보내기 창에서 고쳐 쓴 보고서 칸. 보고 분기처럼 기록 날짜로 정한 기간 글을 열쇠로 두고, 같은 기간을 다시 내보낼 때만 불러옵니다. */
  reportEdits?: Record<string, Partial<Record<ReportField, string>>>;
}

/** 아직 저장하지 않은 이미지 원본(예시 그림, 예전 브라우저 저장소에서 꺼낸 이미지) */
export interface StoredImage {
  id: string;
  blob: Blob;
  name: string;
}

/** 화면에서 쓰는 이미지. url 은 저장 서버가 데이터 폴더의 파일을 내려주는 주소입니다. */
export interface ImageEntry {
  id: string;
  name: string;
  url: string;
}

export type ViewKind = 'recent' | 'month' | 'quarter' | 'year';

/** 기록 추가와 수정 폼이 넘기는 값 */
export interface RecordDraft {
  date: string;
  type: WorkType;
  toolIds: string[];
  title: string;
  description: string;
  effect: string;
  limitHit: boolean;
}
