/** 产状量测部位 */
export type MeasurePosition = '拱顶' | '拱腰左侧' | '拱腰右侧' | '拱脚左侧' | '拱脚右侧' | '边墙';

export const MEASURE_POSITIONS: MeasurePosition[] = [
  '拱顶',
  '拱腰左侧',
  '拱腰右侧',
  '拱脚左侧',
  '拱脚右侧',
  '边墙',
];

/**
 * 岩层产状测点。
 * 同一掌子面在拱顶、拱腰等部位多次量测；最新一条有效测点作为当前基准产状，
 * 无效测点连同原因留档，不参与基准与范围统计。
 */
export interface AttitudeReading {
  id: string;
  faceId: string;
  /** 量测部位 */
  position: MeasurePosition;
  /** 走向 ° */
  strike: number;
  /** 倾向 ° */
  dipDirection: number;
  /** 倾角 ° */
  dipAngle: number;
  /** 是否有效 */
  valid: boolean;
  /** 无效原因（valid 为 false 时填写，留档备查） */
  invalidReason?: string;
  /** 测录时间 */
  measuredAt: number;
}

export type AttitudeReadingDraft = Omit<AttitudeReading, 'id' | 'measuredAt' | 'valid' | 'invalidReason'>;
