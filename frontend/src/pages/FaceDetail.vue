<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import { useJointStore } from '../stores/jointStore';
import { useAttitudeStore } from '../stores/attitudeStore';
import { useGradeCalc } from '../hooks/useGradeCalc';
import SketchCanvas from '../components/common/SketchCanvas.vue';
import GradeTag from '../components/common/GradeTag.vue';
import { attitudeText, formatChainage } from '../utils/geoMath';
import {
  ATTITUDE_INVALID_REASONS,
  ATTITUDE_POSITIONS,
  isValidAttitudeValue,
  validAttitudeRange,
  type AttitudePointDraft,
} from '../types/attitude';
import { GRADE_SUPPORT } from '../types/grade';

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
const validPoints = computed(() => attitudeStore.validByFace(faceId.value));
const invalidPoints = computed(() => attitudeStore.invalidByFace(faceId.value));
const currentPoint = computed(() => validPoints.value[0]);
const attitudeRange = computed(() => validAttitudeRange(validPoints.value));
const currentAttitude = computed(() =>
  face.value ? attitudeStore.currentAttitude(faceId.value, face.value.attitude) : undefined,
);
const baselineSourceText = computed(() =>
  currentPoint.value
    ? `来自 ${currentPoint.value.position} 测点 · ${new Date(currentPoint.value.measuredAt).toLocaleString('zh-CN')}`
    : '尚无有效测点，沿用原档案产状',
);
const latest = computed(() => grades.value[0]);
const previousGrade = computed(() => grades.value[1]);

const { result, patch } = useGradeCalc(() => joints.value);
const segmentCount = ref(0);
const attitudeError = ref('');

const attitudeForm = reactive({
  position: '拱顶' as AttitudePointDraft['position'],
  strike: 0,
  dipDirection: 0,
  dipAngle: 0,
  valid: true,
  invalidReason: '',
  measuredAt: new Date(),
});

function fillAttitudeFormFromCurrent(): void {
  if (!face.value) return;
  const source = currentAttitude.value ?? face.value.attitude;
  attitudeForm.strike = source.strike;
  attitudeForm.dipDirection = source.dipDirection;
  attitudeForm.dipAngle = source.dipAngle;
}

function onValidChange(valid: boolean): void {
  attitudeForm.invalidReason = '';
  if (valid) {
    attitudeForm.strike = Math.min(360, Math.max(0, attitudeForm.strike));
    attitudeForm.dipDirection = Math.min(360, Math.max(0, attitudeForm.dipDirection));
    attitudeForm.dipAngle = Math.min(90, Math.max(0, attitudeForm.dipAngle));
  }
}

async function submitAttitudePoint(): Promise<void> {
  attitudeError.value = '';
  if (!face.value) {
    attitudeError.value = '未指定掌子面';
    return;
  }
  if (!attitudeForm.measuredAt || Number.isNaN(attitudeForm.measuredAt.getTime())) {
    attitudeError.value = '请选择测录时间';
    return;
  }
  if (![attitudeForm.strike, attitudeForm.dipDirection, attitudeForm.dipAngle].every(Number.isFinite)) {
    attitudeError.value = '走向、倾向、倾角必须填写数值';
    return;
  }
  if (attitudeForm.valid) {
    if (!isValidAttitudeValue(attitudeForm.strike, 360) || !isValidAttitudeValue(attitudeForm.dipDirection, 360)) {
      attitudeError.value = '有效测点的走向、倾向需在 0 ~ 360° 之间';
      return;
    }
    if (!isValidAttitudeValue(attitudeForm.dipAngle, 90)) {
      attitudeError.value = '有效测点的倾角需在 0 ~ 90° 之间';
      return;
    }
  } else if (!attitudeForm.invalidReason.trim()) {
    attitudeError.value = '无效测点必须填写原因后留档';
    return;
  }

  await attitudeStore.add({
    faceId: face.value.id,
    position: attitudeForm.position,
    strike: attitudeForm.strike,
    dipDirection: attitudeForm.dipDirection,
    dipAngle: attitudeForm.dipAngle,
    valid: attitudeForm.valid,
    invalidReason: attitudeForm.valid ? '' : attitudeForm.invalidReason.trim(),
    measuredAt: attitudeForm.measuredAt.getTime(),
  });
  ElMessage.success(attitudeForm.valid ? '有效测点已保存，并更新当前基准' : '无效测点已连同原因留档');
  attitudeForm.position = '拱顶';
  attitudeForm.strike = 0;
  attitudeForm.dipDirection = 0;
  attitudeForm.dipAngle = 0;
  attitudeForm.invalidReason = '';
  attitudeForm.valid = true;
  attitudeForm.measuredAt = new Date();
}

function attitudeRangeText(): string {
  if (!attitudeRange.value) return '—';
  const range = attitudeRange.value;
  const sameDirection = range.dipDirectionMin === range.dipDirectionMax;
  const sameAngle = range.dipAngleMin === range.dipAngleMax;
  return `倾向 ${sameDirection ? range.dipDirectionMin : `${range.dipDirectionMin} ~ ${range.dipDirectionMax}`}°；倾角 ${
    sameAngle ? range.dipAngleMin : `${range.dipAngleMin} ~ ${range.dipAngleMax}`
  }°`;
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
  fillAttitudeFormFromCurrent();
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
            <el-descriptions-item label="原档案产状">
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
              <strong>岩层产状测点</strong>
              <el-tag type="success" effect="plain">有效 {{ validPoints.length }}</el-tag>
              <el-tag type="danger" effect="plain">无效 {{ invalidPoints.length }}</el-tag>
            </div>
          </template>

          <el-alert
            :type="currentPoint ? 'success' : 'info'"
            :closable="false"
            show-icon
            class="baseline-alert"
            :title="`当前基准：走向 ${currentAttitude?.strike ?? face.attitude.strike}° · ${attitudeText(
              currentAttitude?.dipDirection ?? face.attitude.dipDirection,
              currentAttitude?.dipAngle ?? face.attitude.dipAngle,
            )}`"
            :description="`${baselineSourceText}；有效测点范围：${attitudeRangeText()}`"
          />

          <el-form :model="attitudeForm" label-width="92px" class="attitude-form">
            <el-alert v-if="attitudeError" :title="attitudeError" type="error" :closable="false" style="margin-bottom: 10px" />
            <el-form-item label="测点部位">
              <el-select v-model="attitudeForm.position">
                <el-option v-for="position in ATTITUDE_POSITIONS" :key="position" :label="position" :value="position" />
              </el-select>
            </el-form-item>
            <el-form-item label="走向 °">
              <el-input-number
                v-model="attitudeForm.strike"
                :min="attitudeForm.valid ? 0 : Number.NEGATIVE_INFINITY"
                :max="attitudeForm.valid ? 360 : Number.POSITIVE_INFINITY"
              />
            </el-form-item>
            <el-form-item label="倾向 °">
              <el-input-number
                v-model="attitudeForm.dipDirection"
                :min="attitudeForm.valid ? 0 : Number.NEGATIVE_INFINITY"
                :max="attitudeForm.valid ? 360 : Number.POSITIVE_INFINITY"
              />
            </el-form-item>
            <el-form-item label="倾角 °">
              <el-input-number
                v-model="attitudeForm.dipAngle"
                :min="attitudeForm.valid ? 0 : Number.NEGATIVE_INFINITY"
                :max="attitudeForm.valid ? 90 : Number.POSITIVE_INFINITY"
              />
            </el-form-item>
            <el-form-item label="测录时间">
              <el-date-picker v-model="attitudeForm.measuredAt" type="datetime" placeholder="选择测录时间" />
            </el-form-item>
            <el-form-item label="测点状态">
              <el-switch
                v-model="attitudeForm.valid"
                active-text="有效"
                inactive-text="无效留档"
                inline-prompt
                @change="onValidChange"
              />
            </el-form-item>
            <el-form-item v-if="!attitudeForm.valid" label="无效原因" required>
              <el-select
                v-model="attitudeForm.invalidReason"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入原因"
                style="width: 260px"
              >
                <el-option v-for="reason in ATTITUDE_INVALID_REASONS" :key="reason" :label="reason" :value="reason" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="submitAttitudePoint">保存测点</el-button>
              <el-button @click="fillAttitudeFormFromCurrent">按当前基准带出</el-button>
            </el-form-item>
          </el-form>

          <el-divider content-position="left">有效测点（按测录时间倒序，最新一条为当前基准）</el-divider>
          <el-table :data="validPoints" size="small" border>
            <el-table-column label="基准" width="64">
              <template #default="{ row }">
                <el-tag v-if="currentPoint?.id === row.id" type="success" size="small">当前</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="position" label="部位" width="82" />
            <el-table-column prop="strike" label="走向°" width="76" />
            <el-table-column prop="dipDirection" label="倾向°" width="76" />
            <el-table-column prop="dipAngle" label="倾角°" width="76" />
            <el-table-column label="测录时间" min-width="170">
              <template #default="{ row }">{{ new Date(row.measuredAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-if="validPoints.length === 0" description="暂无有效测点，节理录入沿用原产状" :image-size="60" />

          <el-divider content-position="left">无效测点留档</el-divider>
          <el-table :data="invalidPoints" size="small" border>
            <el-table-column prop="position" label="部位" width="82" />
            <el-table-column prop="strike" label="走向°" width="76" />
            <el-table-column prop="dipDirection" label="倾向°" width="76" />
            <el-table-column prop="dipAngle" label="倾角°" width="76" />
            <el-table-column prop="invalidReason" label="原因" min-width="150" />
            <el-table-column label="测录时间" min-width="170">
              <template #default="{ row }">{{ new Date(row.measuredAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-if="invalidPoints.length === 0" description="暂无无效测点" :image-size="60" />
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
          :attitude="currentAttitude ?? face.attitude"
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
.baseline-alert {
  margin-bottom: 12px;
}
.attitude-form :deep(.el-form-item) {
  margin-bottom: 14px;
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
</style>
