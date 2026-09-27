import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { AttitudeReading, AttitudeReadingDraft } from '../types/attitude';

interface AttitudeState {
  items: AttitudeReading[];
  loaded: boolean;
}

/** 有效测点的倾向 / 倾角范围 */
export interface AttitudeRange {
  dipDirection: [number, number];
  dipAngle: [number, number];
}

export const useAttitudeStore = defineStore('attitude', {
  state: (): AttitudeState => ({ items: [], loaded: false }),
  getters: {
    /** 有效测点按测录时间排列（最新在前，第一条即当前基准） */
    validByFace: (state) => (faceId: string) =>
      state.items
        .filter((it) => it.faceId === faceId && it.valid)
        .sort((a, b) => b.measuredAt - a.measuredAt),
    /** 无效测点留档，按测录时间排列（最新在前） */
    invalidByFace: (state) => (faceId: string) =>
      state.items
        .filter((it) => it.faceId === faceId && !it.valid)
        .sort((a, b) => b.measuredAt - a.measuredAt),
    /** 当前基准：最新一条有效测点；无有效测点时返回 undefined（调用方沿用编录产状） */
    baselineByFace(): (faceId: string) => AttitudeReading | undefined {
      return (faceId) => this.validByFace(faceId)[0];
    },
    /** 有效测点的倾向 / 倾角范围 */
    rangeByFace(): (faceId: string) => AttitudeRange | undefined {
      return (faceId) => {
        const list = this.validByFace(faceId);
        if (list.length === 0) return undefined;
        const dirs = list.map((r) => r.dipDirection);
        const angs = list.map((r) => r.dipAngle);
        return {
          dipDirection: [Math.min(...dirs), Math.max(...dirs)],
          dipAngle: [Math.min(...angs), Math.max(...angs)],
        };
      };
    },
  },
  actions: {
    async load() {
      const rows = await db.attitudes.toArray();
      rows.sort((a, b) => b.measuredAt - a.measuredAt);
      this.items = rows;
      this.loaded = true;
    },
    async add(draft: AttitudeReadingDraft) {
      const record: AttitudeReading = {
        ...toPlain(draft),
        id: newId('att'),
        valid: true,
        measuredAt: Date.now(),
      };
      await db.attitudes.put(toPlain(record));
      this.items = [record, ...this.items];
      return record;
    },
    /** 作废测点：连同原因留档，不删除 */
    async invalidate(id: string, reason: string) {
      const patch = { valid: false, invalidReason: reason };
      await db.attitudes.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
  },
});
