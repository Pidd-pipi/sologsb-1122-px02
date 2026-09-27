import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { latestValidPoint, asAttitude, type AttitudePoint, type AttitudePointDraft } from '../types/attitude';
import type { Attitude } from '../types/face';

interface AttitudeState {
  items: AttitudePoint[];
  loaded: boolean;
}

export const useAttitudeStore = defineStore('attitude', {
  state: (): AttitudeState => ({ items: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items
        .filter((point) => point.faceId === faceId)
        .sort((a, b) => b.measuredAt - a.measuredAt || b.createdAt - a.createdAt),
    validByFace:
      (state) =>
      (faceId: string): AttitudePoint[] => {
        const points = state.items.filter((point) => point.faceId === faceId && point.valid);
        return points.sort((a, b) => b.measuredAt - a.measuredAt || b.createdAt - a.createdAt);
      },
    invalidByFace: (state) => (faceId: string) =>
      state.items
        .filter((point) => point.faceId === faceId && !point.valid)
        .sort((a, b) => b.measuredAt - a.measuredAt || b.createdAt - a.createdAt),
  },
  actions: {
    async load() {
      const rows = await db.attitudes.toArray();
      rows.sort((a, b) => b.measuredAt - a.measuredAt || b.createdAt - a.createdAt);
      this.items = rows;
      this.loaded = true;
    },
    async add(draft: AttitudePointDraft) {
      const now = Date.now();
      const record: AttitudePoint = {
        ...toPlain(draft),
        id: newId('attitude'),
        createdAt: now,
      };
      await db.attitudes.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    async remove(id: string) {
      await db.attitudes.delete(id);
      this.items = this.items.filter((point) => point.id !== id);
    },
    /** 当前基准：最新有效测点；无有效测点时由调用方沿用掌子面原产状 */
    currentAttitude(faceId: string, fallback: Attitude): Attitude {
      const point = latestValidPoint(this.items.filter((item) => item.faceId === faceId));
      return point ? asAttitude(point) : fallback;
    },
  },
});
