<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import { useJointStore } from '../stores/jointStore';
import { useAttitudeStore } from '../stores/attitudeStore';
import { useGradeCalc } from '../hooks/useGradeCalc';
import SketchCanvas from '../components/common/SketchCanvas.vue';
import GradeTag from '../components/common/GradeTag.vue';
import { attitudeText, formatChainage } from '../utils/geoMath';
import { GRADE_SUPPORT } from '../types/grade';
import { MEASURE_POSITIONS, type AttitudeReadingDraft } from '../types/attitude';

const route = useRoute();
const router = useRouter();
const faceStore = useFaceStore();
const jointStore = useJointStore();
const gradeStore = useGradeStore();
const attitudeStore = useAttitudeStore();

const faceId = computed(() => String(route.params.id ?? ''));
const face = computed(() => faceStore.byId(faceId.value));
const joints = computed(() => jointStore.byFace(faceId.value));
const grades = computed(() => gradeStore.byFace(faceId.value));
const latest = computed(() => grades.value[0]);
const previousGrade = computed(() => grades.value[1]);

const { result, patch } = useGradeCalc(() => joints.value);
const segmentCount = ref(0);

/** 产状测点：有效按测录时间排列，最新一条为当前基准；无效连同原因留档 */
const validReadings = computed(() => attitudeStore.validByFace(faceId.value));
const invalidReadings = computed(() => attitudeStore.invalidByFace(faceId.value));
const baseline = computed(() => attitudeStore.baselineByFace(faceId.value));
const range = computed(() => attitudeStore.rangeByFace(faceId.value));

const readingError = ref('');
const readingForm = reactive<AttitudeReadingDraft>({
  faceId: '',
  position: '拱顶',
  strike: 0,
  dipDirection: 0,
  dipAngle: 0,
});

/** 表单默认带出当前基准；无有效测点时沿用编录产状，方便连续复测 */
function resetReadingForm(): void {
  readingForm.faceId = faceId.value;
  const src = baseline.value ?? face.value?.attitude;
  if (src) {
    readingForm.strike = src.strike;
    readingForm.dipDirection = src.dipDirection;
    readingForm.dipAngle = src.dipAngle;
  }
}

watch(faceId, resetReadingForm, { immediate: true });

/** 倾向 / 倾角范围文字，如「倾向 128° ~ 142° · 倾角 28° ~ 46°」 */
const rangeText = computed(() => {
  const r = range.value;
  if (!r) return '';
  const fmt = ([a, b]: [number, number]) => (a === b ? `${a}°` : `${a}° ~ ${b}°`);
  return `倾向 ${fmt(r.dipDirection)} · 倾角 ${fmt(r.dipAngle)}`;
});

async function submitReading() {
  readingError.value = '';
  if (!face.value) return;
  const { strike, dipDirection, dipAngle } = readingForm;
  if (![strike, dipDirection, dipAngle].every((v) => Number.isFinite(v))) {
    readingError.value = '走向、倾向、倾角都必须填写数字';
    return;
  }
  if (strike < 0 || strike > 360 || dipDirection < 0 || dipDirection > 360) {
    readingError.value = '走向 / 倾向需在 0 ~ 360° 之间';
    return;
  }
  if (dipAngle < 0 || dipAngle > 90) {
    readingError.value = '倾角需在 0 ~ 90° 之间';
    return;
  }
  await attitudeStore.add({ ...readingForm, faceId: faceId.value });
  ElMessage.success(`已记录${readingForm.position}测点：走向 ${strike}°，${attitudeText(dipDirection, dipAngle)}`);
  // 新测点成为当前基准，表单自动带出便于下一条复测
  resetReadingForm();
}

/** 作废测点：原因必填，记录留档不删除 */
async function invalidateReading(id: string) {
  try {
    const { value } = await ElMessageBox.prompt('该测点将标记为无效并留档，请填写无效原因', '作废测点', {
      confirmButtonText: '确认作废',
      cancelButtonText: '取消',
      inputPlaceholder: '如：罗盘贴到松动岩块，读数不可信',
      inputValidator: (v: string) => (v && v.trim() ? true : '必须填写无效原因'),
    });
    await attitudeStore.invalidate(id, value.trim());
    ElMessage.success('已标记为无效测点并留档');
  } catch {
    /* 用户取消 */
  }
}

/** SketchCanvas 变更回调（用命名函数避免模板内联箭头参数丢类型） */
function onSketchChange(segs: { id: string }[]): void {
  segmentCount.value = segs.length;
}

/** 与上循环级别比对结论 */
const gradeCompare = computed(() => {
  if (!latest.value) return '本掌子面尚无级别判定记录';
  if (!previousGrade.value) return `本掌子面首次判定为 ${latest.value.grade} 级围岩`;
  const order = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'];
  const delta = order.indexOf(latest.value.grade) - order.indexOf(previousGrade.value.grade);
  if (delta === 0) return `与上一循环一致（${latest.value.grade} 级）`;
  return delta > 0
    ? `较上一循环变差 ${delta} 级：${previousGrade.value.grade} → ${latest.value.grade}`
    : `较上一循环变好 ${-delta} 级：${previousGrade.value.grade} → ${latest.value.grade}`;
});

onMounted(async () => {
  await faceStore.load();
  await jointStore.load();
  await gradeStore.load();
  await attitudeStore.load();
  resetReadingForm();
  if (face.value) {
    patch({ rockStrength: face.value.rockStrength, spanWidth: Number(face.value.faceSize.split('×')[0]) || 12 });
  }
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>掌子面详情 · {{ face?.faceNo ?? '未找到' }}</h2>
      <GradeTag v-if="latest" :grade="latest.grade" />
      <el-tag v-else type="info">未判定级别</el-tag>
      <el-tag type="info" effect="plain">节理 {{ joints.length }} 组</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="router.push(`/faces/${faceId}/joints`)">节理录入</el-button>
      <el-button @click="router.push(`/faces/${faceId}/water`)">涌水记录</el-button>
      <el-button @click="router.push(`/grade/${faceId}`)">围岩级别判定</el-button>
      <el-button @click="router.push('/faces')">返回台账</el-button>
    </div>

    <el-alert v-if="!face" type="warning" :closable="false" show-icon title="未找到该掌子面（可能已被删除）" />

    <div v-if="face" class="grid">
      <div class="left">
        <el-card shadow="never">
          <template #header><strong>基本信息</strong></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="掌子面编号">{{ face.faceNo }}</el-descriptions-item>
            <el-descriptions-item label="里程桩号">{{ formatChainage(face.chainage) }}</el-descriptions-item>
            <el-descriptions-item label="编录里程区间">
              {{ formatChainage(face.mileageRange[0]) }} ~ {{ formatChainage(face.mileageRange[1]) }}
            </el-descriptions-item>
            <el-descriptions-item label="开挖方式">{{ face.excavationMethod }}</el-descriptions-item>
            <el-descriptions-item label="开挖断面尺寸">{{ face.faceSize }} m</el-descriptions-item>
            <el-descriptions-item label="岩性 / 风化">{{ face.lithology }} / {{ face.weathering }}</el-descriptions-item>
            <el-descriptions-item label="饱和抗压强度">{{ face.rockStrength }} MPa</el-descriptions-item>
            <el-descriptions-item label="岩层产状">
              走向 {{ face.attitude.strike }}° · {{ attitudeText(face.attitude.dipDirection, face.attitude.dipAngle) }}
            </el-descriptions-item>
            <el-descriptions-item label="地质员">{{ face.geologist }}</el-descriptions-item>
            <el-descriptions-item label="编录时间">
              {{ new Date(face.recordedAt).toLocaleString('zh-CN') }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>产状测点</strong>
              <template v-if="baseline">
                <el-tag type="success" effect="plain">
                  当前基准：{{ baseline.position }} · 走向 {{ baseline.strike }}° ·
                  {{ attitudeText(baseline.dipDirection, baseline.dipAngle) }}
                </el-tag>
                <el-tag type="info" effect="plain">{{ rangeText }}</el-tag>
              </template>
              <el-tag v-else type="info" effect="plain">
                暂无有效测点，沿用编录产状 {{ attitudeText(face.attitude.dipDirection, face.attitude.dipAngle) }}
              </el-tag>
            </div>
          </template>

          <el-alert v-if="readingError" :title="readingError" type="error" :closable="false" style="margin-bottom: 10px" />
          <el-form :inline="true" @submit.prevent>
            <el-form-item label="部位">
              <el-select v-model="readingForm.position" style="width: 116px">
                <el-option v-for="p in MEASURE_POSITIONS" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="走向 °">
              <el-input-number v-model="readingForm.strike" :min="0" :max="360" controls-position="right" style="width: 104px" />
            </el-form-item>
            <el-form-item label="倾向 °">
              <el-input-number v-model="readingForm.dipDirection" :min="0" :max="360" controls-position="right" style="width: 104px" />
            </el-form-item>
            <el-form-item label="倾角 °">
              <el-input-number v-model="readingForm.dipAngle" :min="0" :max="90" controls-position="right" style="width: 104px" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="submitReading">记录测点</el-button>
            </el-form-item>
          </el-form>

          <el-table :data="validReadings" size="small" border>
            <el-table-column label="测录时间" width="160">
              <template #default="{ row }">{{ new Date(row.measuredAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column prop="position" label="部位" width="96" />
            <el-table-column prop="strike" label="走向 °" width="80" />
            <el-table-column label="倾向 ∠ 倾角" width="120">
              <template #default="{ row }">{{ attitudeText(row.dipDirection, row.dipAngle) }}</template>
            </el-table-column>
            <el-table-column label="基准" width="86">
              <template #default="{ row }">
                <el-tag v-if="baseline && row.id === baseline.id" type="success" size="small">当前基准</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button size="small" type="danger" plain @click="invalidateReading(row.id)">作废</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="validReadings.length === 0" description="暂无有效测点" :image-size="60" />

          <template v-if="invalidReadings.length > 0">
            <el-divider content-position="left">无效测点留档（{{ invalidReadings.length }}）</el-divider>
            <el-table :data="invalidReadings" size="small" border class="invalid-table">
              <el-table-column label="测录时间" width="160">
                <template #default="{ row }">{{ new Date(row.measuredAt).toLocaleString('zh-CN') }}</template>
              </el-table-column>
              <el-table-column prop="position" label="部位" width="96" />
              <el-table-column prop="strike" label="走向 °" width="80" />
              <el-table-column label="倾向 ∠ 倾角" width="120">
                <template #default="{ row }">{{ attitudeText(row.dipDirection, row.dipAngle) }}</template>
              </el-table-column>
              <el-table-column prop="invalidReason" label="无效原因" min-width="140" show-overflow-tooltip />
            </el-table>
          </template>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>级别与支护</strong></template>
          <div v-if="latest" class="grade-box">
            <GradeTag :grade="latest.grade" />
            <span class="muted">[BQ] = {{ latest.correctedBq }}（BQ {{ latest.bqValue }}，修正 {{ latest.correction }}）</span>
            <p class="support">{{ latest.supportSuggestion || GRADE_SUPPORT[latest.grade] }}</p>
            <p class="muted">{{ gradeCompare }}</p>
          </div>
          <div v-else>
            <p class="muted">尚未判定级别，按当前参数实时试算：</p>
            <GradeTag :grade="result.grade" />
            <p class="support">{{ result.support }}</p>
          </div>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>节理组列表（{{ joints.length }} 组）</strong></template>
          <el-table :data="joints" size="small" border>
            <el-table-column label="组号" width="70">
              <template #default="{ row }">J{{ row.setNo }}</template>
            </el-table-column>
            <el-table-column label="产状" width="140">
              <template #default="{ row }">{{ attitudeText(row.dipDirection, row.dipAngle) }}</template>
            </el-table-column>
            <el-table-column prop="spacing" label="间距 cm" width="90" />
            <el-table-column prop="persistence" label="延伸 m" width="90" />
            <el-table-column prop="aperture" label="张开 mm" width="90" />
            <el-table-column prop="fillMaterial" label="充填" width="90" />
            <el-table-column prop="waterWet" label="渗水" width="90" />
            <el-table-column prop="jointCount" label="条数" width="80" />
          </el-table>
          <el-empty v-if="joints.length === 0" description="暂无节理组记录" :image-size="60" />
        </el-card>
      </div>

      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>岩性素描图</strong>
            <span class="muted">已布置 {{ segmentCount }} 条结构面线段（自动保存在浏览器本地）</span>
          </div>
        </template>
        <SketchCanvas
          :face-id="face.id"
          :lithology="face.lithology"
          :attitude="face.attitude"
          @change="onSketchChange"
        />
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: 620px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.support {
  margin: 8px 0;
  color: #2f3a46;
}
.grade-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.invalid-table {
  opacity: 0.72;
}
</style>
