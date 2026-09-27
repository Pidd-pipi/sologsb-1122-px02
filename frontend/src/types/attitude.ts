import type { Attitude } from './face';

/** 产状量测部位 */
export type AttitudePosition = '拱顶' | '左拱腰' | '右拱腰';

export const ATTITUDE_POSITIONS: AttitudePosition[] = ['拱顶', '左拱腰', '右拱腰'];

/** 无效测点的常见原因 */
export const ATTITUDE_INVALID_REASONS = ['罗盘受机械干扰', '岩面破碎无法识别', '测点被渗水泥浆覆盖', '读数异常'];

/** 产状测点 */
export interface AttitudePoint extends Attitude {
  id: string;
  faceId: string;
  position: AttitudePosition;
  /** 是否为可用于当前岩层判断的有效测点 */
  valid: boolean;
  /** 无效原因；有效测点为空 */
  invalidReason: string;
  /** 现场测录时间 */
  measuredAt: number;
  /** 入库时间；测录时间相同时用于稳定排序 */
  createdAt: number;
}

export type AttitudePointDraft = Omit<AttitudePoint, 'id' | 'createdAt'>;

/** 生成当前产状基准 */
export function asAttitude(point: AttitudePoint): Attitude {
  return {
    strike: point.strike,
    dipDirection: point.dipDirection,
    dipAngle: point.dipAngle,
  };
}

/** 有效测点按测录时间倒序排列 */
export function sortValidPointsDesc(points: AttitudePoint[]): AttitudePoint[] {
  return [...points]
    .filter((point) => point.valid)
    .sort((a, b) => b.measuredAt - a.measuredAt || b.createdAt - a.createdAt);
}

/** 取最新有效测点；没有有效测点时返回 undefined */
export function latestValidPoint(points: AttitudePoint[]): AttitudePoint | undefined {
  return sortValidPointsDesc(points)[0];
}

export interface AttitudeRange {
  dipDirectionMin: number;
  dipDirectionMax: number;
  dipAngleMin: number;
  dipAngleMax: number;
}

/** 统计有效测点的倾向、倾角范围 */
export function validAttitudeRange(points: AttitudePoint[]): AttitudeRange | undefined {
  const valid = sortValidPointsDesc(points);
  if (valid.length === 0) return undefined;

  const dipDirections = valid.map((point) => point.dipDirection);
  const dipAngles = valid.map((point) => point.dipAngle);
  return {
    dipDirectionMin: Math.min(...dipDirections),
    dipDirectionMax: Math.max(...dipDirections),
    dipAngleMin: Math.min(...dipAngles),
    dipAngleMax: Math.max(...dipAngles),
  };
}

/** 测点角度是否落在可接受范围内 */
export function isValidAttitudeValue(value: number, max: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= max;
}
