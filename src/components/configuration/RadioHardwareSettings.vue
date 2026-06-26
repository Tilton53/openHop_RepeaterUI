<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSystemStore } from '@/stores/system';
import { ApiService } from '@/utils/api';
import RestartModal from '@/components/modals/RestartModal.vue';
import UnsavedChangesModal from '@/components/ui/UnsavedChangesModal.vue';
import { useUnsavedChanges } from '@/composables/useUnsavedChanges';

type SupportedRadioType = 'sx1262' | 'sx1262_ch341' | 'kiss' | 'pymc_tcp' | 'pymc_usb' | 'none';

interface RadioTypeOption {
  value: SupportedRadioType;
  label: string;
  detail: string;
}

interface HardwareOption {
  key: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
}

interface RadioEntryForm {
  id: string;
  radio_type: SupportedRadioType;
  kiss: {
    port: string;
    baud_rate: number;
  };
  pymc_usb: {
    port: string;
    baudrate: number;
  };
  pymc_tcp: {
    host: string;
    port: number;
    token: string;
  };
  sx1262: {
    bus_id: number;
    cs_id: number;
    cs_pin: number;
    reset_pin: number;
    busy_pin: number;
    irq_pin: number;
    txen_pin: number;
    rxen_pin: number;
    en_pin: number;
    en_pins_input: string;
    txled_pin: number;
    rxled_pin: number;
  };
  ch341: {
    vid: number;
    pid: number;
  };
  ui: {
    useCustomSerialPath: boolean;
    selectedBoardPresetKey: string;
  };
}

const systemStore = useSystemStore();

const radioTypeOptions: RadioTypeOption[] = [
  {
    value: 'sx1262',
    label: 'sx1262',
    detail: 'Linux spidev + system GPIO',
  },
  {
    value: 'sx1262_ch341',
    label: 'sx1262_ch341',
    detail: 'CH341 USB-to-SPI',
  },
  {
    value: 'kiss',
    label: 'kiss',
    detail: 'KISS-modem over serial',
  },
  {
    value: 'pymc_tcp',
    label: 'pymc_tcp',
    detail: 'pymc_tcp firmware modem over Wi-Fi/TCP',
  },
  {
    value: 'pymc_usb',
    label: 'pymc_usb',
    detail: 'pymc_usb firmware modem over USB-CDC',
  },
  {
    value: 'none',
    label: 'none',
    detail: 'Disable radio hardware (no RF I/O)',
  },
];

const config = computed<Record<string, any>>(() => {
  const stats = systemStore.stats as Record<string, any> | null;
  if (!stats) return {};
  const nested = (stats.config as Record<string, any> | undefined) ?? {};
  return { ...stats, ...nested };
});

const isEditing = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');
const showRestartModal = ref(false);
const serialDevices = ref<Array<{ device: string; description?: string }>>([]);
const serialDevicesLoading = ref(false);
const serialDevicesError = ref('');
const hardwareOptions = ref<HardwareOption[]>([]);
const hardwareOptionsLoading = ref(false);
const hardwareOptionsError = ref('');
const radioEntries = ref<RadioEntryForm[]>([]);
let nextRadioEntryId = 0;

function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRadioType(value: unknown): SupportedRadioType {
  if (value === null || value === undefined) return 'none';
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || ['none', 'null', 'disabled', 'off', 'no_radio'].includes(normalized)) {
    return 'none';
  }
  if (normalized === 'kiss-modem') return 'kiss';
  if (normalized === 'sx1262') return 'sx1262';
  if (normalized === 'sx1262_ch341') return 'sx1262_ch341';
  if (normalized === 'kiss') return 'kiss';
  if (normalized === 'pymc_tcp') return 'pymc_tcp';
  if (normalized === 'pymc_usb') return 'pymc_usb';
  return 'none';
}

function parseEnPins(input: string): number[] {
  return input
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n));
}

function nextEntryId(): string {
  nextRadioEntryId += 1;
  return `radio-entry-${nextRadioEntryId}`;
}

function createDefaultRadioEntry(type: SupportedRadioType = 'none'): RadioEntryForm {
  return {
    id: nextEntryId(),
    radio_type: type,
    kiss: {
      port: '/dev/ttyUSB0',
      baud_rate: 9600,
    },
    pymc_usb: {
      port: '/dev/ttyACM0',
      baudrate: 921600,
    },
    pymc_tcp: {
      host: '',
      port: 5055,
      token: '',
    },
    sx1262: {
      bus_id: 0,
      cs_id: 0,
      cs_pin: 21,
      reset_pin: 18,
      busy_pin: 20,
      irq_pin: 16,
      txen_pin: -1,
      rxen_pin: -1,
      en_pin: -1,
      en_pins_input: '',
      txled_pin: -1,
      rxled_pin: -1,
    },
    ch341: {
      vid: 6790,
      pid: 21778,
    },
    ui: {
      useCustomSerialPath: false,
      selectedBoardPresetKey: '',
    },
  };
}

function getHardwareRadioType(option: HardwareOption): SupportedRadioType {
  const raw = option.config?.radio_type;
  if (raw === undefined || raw === null || raw === '') return 'sx1262';
  return normalizeRadioType(raw);
}

function createRadioEntryFromConfig(source: Record<string, unknown>): RadioEntryForm {
  const entry = createDefaultRadioEntry(normalizeRadioType(source.radio_type));
  const kiss = (source.kiss ?? {}) as Record<string, unknown>;
  const pymcUsb = (source.pymc_usb ?? {}) as Record<string, unknown>;
  const pymcTcp = (source.pymc_tcp ?? {}) as Record<string, unknown>;
  const sx = (source.sx1262 ?? {}) as Record<string, unknown>;
  const ch341 = (source.ch341 ?? {}) as Record<string, unknown>;

  entry.kiss.port = asString(kiss.port, entry.kiss.port);
  entry.kiss.baud_rate = asNumber(kiss.baud_rate, entry.kiss.baud_rate);

  entry.pymc_usb.port = asString(pymcUsb.port, entry.pymc_usb.port);
  entry.pymc_usb.baudrate = asNumber(pymcUsb.baudrate, entry.pymc_usb.baudrate);

  entry.pymc_tcp.host = asString(pymcTcp.host, '');
  entry.pymc_tcp.port = asNumber(pymcTcp.port, entry.pymc_tcp.port);
  entry.pymc_tcp.token = asString(pymcTcp.token, '');

  entry.sx1262.bus_id = asNumber(sx.bus_id, entry.sx1262.bus_id);
  entry.sx1262.cs_id = asNumber(sx.cs_id, entry.sx1262.cs_id);
  entry.sx1262.cs_pin = asNumber(sx.cs_pin, entry.sx1262.cs_pin);
  entry.sx1262.reset_pin = asNumber(sx.reset_pin, entry.sx1262.reset_pin);
  entry.sx1262.busy_pin = asNumber(sx.busy_pin, entry.sx1262.busy_pin);
  entry.sx1262.irq_pin = asNumber(sx.irq_pin, entry.sx1262.irq_pin);
  entry.sx1262.txen_pin = asNumber(sx.txen_pin, entry.sx1262.txen_pin);
  entry.sx1262.rxen_pin = asNumber(sx.rxen_pin, entry.sx1262.rxen_pin);
  entry.sx1262.en_pin = asNumber(sx.en_pin, entry.sx1262.en_pin);
  entry.sx1262.txled_pin = asNumber(sx.txled_pin, entry.sx1262.txled_pin);
  entry.sx1262.rxled_pin = asNumber(sx.rxled_pin, entry.sx1262.rxled_pin);
  entry.sx1262.en_pins_input = Array.isArray(sx.en_pins)
    ? sx.en_pins
        .map((pin) => Number(pin))
        .filter((pin) => Number.isFinite(pin))
        .join(', ')
    : '';

  entry.ch341.vid = asNumber(ch341.vid, entry.ch341.vid);
  entry.ch341.pid = asNumber(ch341.pid, entry.ch341.pid);

  return entry;
}

function extractConfiguredRadios(nextConfig: Record<string, unknown>): RadioEntryForm[] {
  const configuredRadios = Array.isArray(nextConfig.radios) ? nextConfig.radios : null;

  if (configuredRadios && configuredRadios.length > 0) {
    return configuredRadios.map((radio) => createRadioEntryFromConfig((radio ?? {}) as Record<string, unknown>));
  }

  return [createRadioEntryFromConfig(nextConfig)];
}

watch(
  config,
  (nextConfig) => {
    if (!isEditing.value) {
      radioEntries.value = extractConfiguredRadios(nextConfig);
    }
  },
  { immediate: true },
);

const currentRadioTypeLabel = computed(() => {
  if (radioEntries.value.length === 0) {
    return 'No radios configured';
  }

  return radioEntries.value
    .map((entry, index) => {
      const match = radioTypeOptions.find((opt) => opt.value === entry.radio_type);
      const label = match ? `${match.label} - ${match.detail}` : 'none - Disable radio hardware (no RF I/O)';
      return `#${index + 1}: ${label}`;
    })
    .join(' • ');
});

function filteredBoardPresets(entry: RadioEntryForm): HardwareOption[] {
  if (entry.radio_type !== 'sx1262' && entry.radio_type !== 'sx1262_ch341') {
    return [];
  }

  return hardwareOptions.value.filter((opt) => getHardwareRadioType(opt) === entry.radio_type);
}

function applyBoardPreset(entry: RadioEntryForm, presetKey: string) {
  const preset = hardwareOptions.value.find((opt) => opt.key === presetKey);
  if (!preset || !preset.config) return;
  const cfg = preset.config;

  entry.sx1262.bus_id = asNumber(cfg.bus_id, entry.sx1262.bus_id);
  entry.sx1262.cs_id = asNumber(cfg.cs_id, entry.sx1262.cs_id);
  entry.sx1262.cs_pin = asNumber(cfg.cs_pin, entry.sx1262.cs_pin);
  entry.sx1262.reset_pin = asNumber(cfg.reset_pin, entry.sx1262.reset_pin);
  entry.sx1262.busy_pin = asNumber(cfg.busy_pin, entry.sx1262.busy_pin);
  entry.sx1262.irq_pin = asNumber(cfg.irq_pin, entry.sx1262.irq_pin);
  entry.sx1262.txen_pin = asNumber(cfg.txen_pin, entry.sx1262.txen_pin);
  entry.sx1262.rxen_pin = asNumber(cfg.rxen_pin, entry.sx1262.rxen_pin);
  entry.sx1262.en_pin = asNumber(cfg.en_pin, entry.sx1262.en_pin);
  entry.sx1262.en_pins_input = Array.isArray(cfg.en_pins)
    ? cfg.en_pins
        .map((pin) => Number(pin))
        .filter((pin) => Number.isFinite(pin))
        .join(', ')
    : '';
  entry.sx1262.txled_pin = asNumber(cfg.txled_pin, entry.sx1262.txled_pin);
  entry.sx1262.rxled_pin = asNumber(cfg.rxled_pin, entry.sx1262.rxled_pin);

  if (entry.radio_type === 'sx1262_ch341') {
    entry.ch341.vid = asNumber(cfg.vid, entry.ch341.vid);
    entry.ch341.pid = asNumber(cfg.pid, entry.ch341.pid);
  }
}

function startEditing() {
  radioEntries.value = extractConfiguredRadios(config.value);
  isEditing.value = true;
  errorMessage.value = '';
}

function cancelEditing() {
  radioEntries.value = extractConfiguredRadios(config.value);
  isEditing.value = false;
  errorMessage.value = '';
}

function addRadioEntry() {
  radioEntries.value.push(createDefaultRadioEntry('none'));
  errorMessage.value = '';
}

function removeRadioEntry(index: number) {
  if (radioEntries.value.length <= 1) {
    radioEntries.value = [createDefaultRadioEntry('none')];
    return;
  }

  radioEntries.value.splice(index, 1);
}

function setRadioType(entry: RadioEntryForm, type: SupportedRadioType) {
  entry.radio_type = type;
  entry.ui.selectedBoardPresetKey = '';
  if (type === 'kiss' || type === 'pymc_usb') {
    void loadSerialDevices();
  }
  if (type === 'sx1262' || type === 'sx1262_ch341') {
    void loadHardwareOptions();
  }
}

function serializeRadioEntry(entry: RadioEntryForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    radio_type: entry.radio_type === 'none' ? null : entry.radio_type,
  };

  if (entry.radio_type === 'kiss') {
    payload.kiss = {
      port: entry.kiss.port.trim() || '/dev/ttyUSB0',
      baud_rate: asNumber(entry.kiss.baud_rate, 9600),
    };
  }

  if (entry.radio_type === 'pymc_usb') {
    payload.pymc_usb = {
      port: entry.pymc_usb.port.trim() || '/dev/ttyACM0',
      baudrate: asNumber(entry.pymc_usb.baudrate, 921600),
    };
  }

  if (entry.radio_type === 'pymc_tcp') {
    payload.pymc_tcp = {
      host: entry.pymc_tcp.host.trim(),
      port: asNumber(entry.pymc_tcp.port, 5055),
      token: entry.pymc_tcp.token,
    };
  }

  if (entry.radio_type === 'sx1262' || entry.radio_type === 'sx1262_ch341') {
    const parsedEnPins = parseEnPins(entry.sx1262.en_pins_input);
    payload.sx1262 = {
      bus_id: asNumber(entry.sx1262.bus_id, 0),
      cs_id: asNumber(entry.sx1262.cs_id, 0),
      cs_pin: asNumber(entry.sx1262.cs_pin, 21),
      reset_pin: asNumber(entry.sx1262.reset_pin, 18),
      busy_pin: asNumber(entry.sx1262.busy_pin, 20),
      irq_pin: asNumber(entry.sx1262.irq_pin, 16),
      txen_pin: asNumber(entry.sx1262.txen_pin, -1),
      rxen_pin: asNumber(entry.sx1262.rxen_pin, -1),
      ...(parsedEnPins.length > 0
        ? { en_pins: parsedEnPins }
        : { en_pin: asNumber(entry.sx1262.en_pin, -1) }),
      txled_pin: asNumber(entry.sx1262.txled_pin, -1),
      rxled_pin: asNumber(entry.sx1262.rxled_pin, -1),
    };
  }

  if (entry.radio_type === 'sx1262_ch341') {
    payload.ch341 = {
      vid: asNumber(entry.ch341.vid, 6790),
      pid: asNumber(entry.ch341.pid, 21778),
    };
  }

  return payload;
}

async function loadHardwareOptions() {
  hardwareOptionsLoading.value = true;
  hardwareOptionsError.value = '';
  try {
    const result = await ApiService.get<Array<HardwareOption>>('hardware_options');

    const legacyHardware = (result as unknown as { hardware?: unknown }).hardware;
    if (Array.isArray(legacyHardware)) {
      hardwareOptions.value = legacyHardware as HardwareOption[];
      return;
    }

    if (result.success && Array.isArray(result.data)) {
      hardwareOptions.value = result.data;
      return;
    }

    hardwareOptions.value = [];
    hardwareOptionsError.value = (result as { error?: string }).error || 'Could not load hardware presets';
  } catch (error: unknown) {
    const e = error as { message?: string };
    hardwareOptions.value = [];
    hardwareOptionsError.value = e.message || 'Could not load hardware presets';
  } finally {
    hardwareOptionsLoading.value = false;
  }
}

async function loadSerialDevices() {
  serialDevicesLoading.value = true;
  serialDevicesError.value = '';
  try {
    const result = await ApiService.getSerialPorts();
    if (result.success && Array.isArray(result.data)) {
      serialDevices.value = result.data;
    } else {
      serialDevices.value = [];
      serialDevicesError.value = result.error || 'Could not load USB serial devices';
    }
  } catch (error: unknown) {
    const e = error as { message?: string };
    serialDevices.value = [];
    serialDevicesError.value = e.message || 'Could not load USB serial devices';
  } finally {
    serialDevicesLoading.value = false;
  }
}

async function saveChanges(): Promise<boolean> {
  isSaving.value = true;
  errorMessage.value = '';

  try {
    const trimmedEntries = radioEntries.value.length > 0 ? radioEntries.value : [createDefaultRadioEntry('none')];

    for (const [index, entry] of trimmedEntries.entries()) {
      if (entry.radio_type === 'pymc_tcp' && !entry.pymc_tcp.host.trim()) {
        errorMessage.value = `Radio ${index + 1}: TCP modem host is required for pymc_tcp`;
        return false;
      }
    }

    const radiosPayload = trimmedEntries.map((entry) => serializeRadioEntry(entry));
    const firstRadio = radiosPayload[0] ?? { radio_type: null };
    const payload: Record<string, unknown> = {
      ...firstRadio,
      radios: radiosPayload,
    };

    const result = await ApiService.importConfig(payload);

    if (!result.success) {
      errorMessage.value = result.error || 'Failed to save settings';
      return false;
    }

    isEditing.value = false;
    await systemStore.fetchStats();
    showRestartModal.value = true;
    return true;
  } catch (error: unknown) {
    const e = error as { response?: { data?: { error?: string } }; message?: string };
    errorMessage.value = e.response?.data?.error || e.message || 'Failed to save settings';
    return false;
  } finally {
    isSaving.value = false;
  }
}

const { showUnsavedModal, requestLeave, handleDiscard, handleSave, handleCancel } = useUnsavedChanges(
  isEditing,
  isSaving,
  cancelEditing,
  async () => saveChanges(),
);

defineExpose({ requestLeave, isEditing });

onMounted(() => {
  void loadSerialDevices();
  void loadHardwareOptions();
});
</script>

<template>
  <RestartModal
    v-model="showRestartModal"
    title="Radio Hardware change requires a restart."
    message="Restart now?"
  />

  <UnsavedChangesModal
    :show="showUnsavedModal"
    :is-saving="isSaving"
    label="Radio Hardware settings"
    @discard="handleDiscard"
    @save="handleSave"
    @cancel="handleCancel"
  />

  <div class="space-y-12">
    <div class="cfg-page-heading flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div>
        <h3 class="text-base sm:text-lg font-semibold text-content-primary dark:text-content-primary mb-1 sm:mb-2">
          Radio Hardware
        </h3>
        <p class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">
          Configure one or more hardware backends for the multi-radio repeater runtime.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          v-if="!isEditing"
          @click="startEditing"
          class="cfg-btn-primary"
        >
          Edit Settings
        </button>
        <template v-else>
          <button
            @click="addRadioEntry"
            :disabled="isSaving"
            class="cfg-btn-secondary"
          >
            Add Radio
          </button>
          <button
            @click="cancelEditing"
            :disabled="isSaving"
            class="cfg-btn-secondary"
          >
            Cancel
          </button>
          <button
            @click="saveChanges"
            :disabled="isSaving"
            class="cfg-btn-primary"
          >
            {{ isSaving ? 'Saving...' : 'Save Changes' }}
          </button>
        </template>
      </div>
    </div>

    <div
      v-if="errorMessage"
      class="bg-red-100 dark:bg-red-500/20 border border-red-500 dark:border-red-500/50 rounded-lg p-3 text-red-700 dark:text-red-400 text-sm"
    >
      {{ errorMessage }}
    </div>

    <div class="cfg-section space-y-3">
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center py-2 border-b border-stroke-subtle dark:border-stroke/10 gap-1">
        <span class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Configured Radios</span>
        <div class="text-content-primary dark:text-content-primary font-mono text-sm break-words">
          {{ currentRadioTypeLabel }}
        </div>
      </div>

      <div class="space-y-6">
        <div
          v-for="(entry, index) in radioEntries"
          :key="entry.id"
          class="rounded-xl border border-stroke-subtle dark:border-stroke/10 bg-background-mute dark:bg-white/5 p-4 space-y-4"
          :data-testid="`radio-entry-${index}`"
        >
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h4 class="text-sm font-semibold text-content-primary dark:text-content-primary">
                Radio {{ index + 1 }}
              </h4>
              <p class="text-xs text-content-secondary dark:text-content-muted">
                Select the transport and its hardware-specific connection details.
              </p>
            </div>
            <button
              v-if="isEditing"
              type="button"
              class="cfg-btn-secondary"
              :disabled="isSaving"
              @click="removeRadioEntry(index)"
            >
              Remove
            </button>
          </div>

          <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <span class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Radio Type</span>
            <div v-if="!isEditing" class="text-content-primary dark:text-content-primary font-mono text-sm">
              {{ radioTypeOptions.find((option) => option.value === entry.radio_type)?.label ?? entry.radio_type }}
            </div>
            <div v-else class="w-full sm:w-80">
              <select
                :value="entry.radio_type"
                class="cfg-select"
                @change="setRadioType(entry, ($event.target as HTMLSelectElement).value as SupportedRadioType)"
              >
                <option
                  v-for="option in radioTypeOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }} - {{ option.detail }}
                </option>
              </select>
            </div>
          </div>

          <template v-if="entry.radio_type === 'kiss' || entry.radio_type === 'pymc_usb'">
            <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <span class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Serial Port</span>
              <div v-if="!isEditing" class="text-content-primary dark:text-content-primary font-mono text-sm break-all">
                {{ entry.radio_type === 'kiss' ? entry.kiss.port : entry.pymc_usb.port }}
              </div>
              <template v-else>
                <div class="w-full sm:w-80 space-y-2">
                  <div class="flex gap-2">
                    <select
                      v-if="entry.radio_type === 'kiss'"
                      v-model="entry.kiss.port"
                      class="cfg-select flex-1"
                      :disabled="entry.ui.useCustomSerialPath"
                    >
                      <option
                        v-if="entry.kiss.port && !serialDevices.some((d) => d.device === entry.kiss.port)"
                        :value="entry.kiss.port"
                      >
                        {{ entry.kiss.port }} (current)
                      </option>
                      <option
                        v-for="dev in serialDevices"
                        :key="`kiss-${entry.id}-${dev.device}`"
                        :value="dev.device"
                      >
                        {{ dev.description || dev.device }}
                      </option>
                    </select>
                    <select
                      v-else
                      v-model="entry.pymc_usb.port"
                      class="cfg-select flex-1"
                      :disabled="entry.ui.useCustomSerialPath"
                    >
                      <option
                        v-if="entry.pymc_usb.port && !serialDevices.some((d) => d.device === entry.pymc_usb.port)"
                        :value="entry.pymc_usb.port"
                      >
                        {{ entry.pymc_usb.port }} (current)
                      </option>
                      <option
                        v-for="dev in serialDevices"
                        :key="`usb-${entry.id}-${dev.device}`"
                        :value="dev.device"
                      >
                        {{ dev.description || dev.device }}
                      </option>
                    </select>
                    <button
                      type="button"
                      class="cfg-btn-secondary"
                      :disabled="serialDevicesLoading"
                      @click="loadSerialDevices"
                    >
                      {{ serialDevicesLoading ? '...' : 'Refresh' }}
                    </button>
                  </div>

                  <label class="flex items-center gap-2 text-xs text-content-secondary dark:text-content-muted">
                    <input v-model="entry.ui.useCustomSerialPath" type="checkbox" />
                    Enter custom device path
                  </label>

                  <input
                    v-if="entry.ui.useCustomSerialPath && entry.radio_type === 'kiss'"
                    v-model="entry.kiss.port"
                    type="text"
                    class="cfg-input"
                    placeholder="/dev/ttyUSB0"
                  />
                  <input
                    v-if="entry.ui.useCustomSerialPath && entry.radio_type !== 'kiss'"
                    v-model="entry.pymc_usb.port"
                    type="text"
                    class="cfg-input"
                    placeholder="/dev/ttyACM0"
                  />

                  <p
                    v-if="serialDevicesError"
                    class="text-xs text-red-600 dark:text-red-400"
                  >
                    {{ serialDevicesError }}
                  </p>
                </div>
              </template>
            </div>

            <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <span class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Baud Rate</span>
              <div v-if="!isEditing" class="text-content-primary dark:text-content-primary font-mono text-sm">
                {{ entry.radio_type === 'kiss' ? entry.kiss.baud_rate : entry.pymc_usb.baudrate }}
              </div>
              <template v-else>
                <input
                  v-if="entry.radio_type === 'kiss'"
                  v-model.number="entry.kiss.baud_rate"
                  type="number"
                  min="1"
                  class="cfg-input w-full sm:w-40"
                />
                <input
                  v-else
                  v-model.number="entry.pymc_usb.baudrate"
                  type="number"
                  min="1"
                  class="cfg-input w-full sm:w-40"
                />
              </template>
            </div>
          </template>

          <template v-if="entry.radio_type === 'pymc_tcp'">
            <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <span class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">TCP Host</span>
              <div v-if="!isEditing" class="text-content-primary dark:text-content-primary font-mono text-sm break-all">
                {{ entry.pymc_tcp.host || 'Not set' }}
              </div>
              <input
                v-else
                v-model="entry.pymc_tcp.host"
                type="text"
                class="cfg-input w-full sm:w-72"
                placeholder="pymc-3e2834.local"
              />
            </div>

            <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <span class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">TCP Port</span>
              <div v-if="!isEditing" class="text-content-primary dark:text-content-primary font-mono text-sm">
                {{ entry.pymc_tcp.port }}
              </div>
              <input
                v-else
                v-model.number="entry.pymc_tcp.port"
                type="number"
                min="1"
                max="65535"
                class="cfg-input w-full sm:w-40"
              />
            </div>

            <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <span class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">TCP Token</span>
              <div v-if="!isEditing" class="text-content-primary dark:text-content-primary font-mono text-sm">
                {{ entry.pymc_tcp.token ? 'Configured' : 'Not set' }}
              </div>
              <input
                v-else
                v-model="entry.pymc_tcp.token"
                type="text"
                class="cfg-input w-full sm:w-72"
                placeholder="Optional"
              />
            </div>
          </template>

          <template v-if="entry.radio_type === 'sx1262' || entry.radio_type === 'sx1262_ch341'">
            <div v-if="isEditing" class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <span class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Board Preset (Quick Apply)</span>
              <div class="w-full sm:w-96 space-y-2">
                <div class="flex gap-2">
                  <select
                    v-model="entry.ui.selectedBoardPresetKey"
                    class="cfg-select flex-1"
                    @change="applyBoardPreset(entry, entry.ui.selectedBoardPresetKey)"
                  >
                    <option value="">Leave current pin values unchanged</option>
                    <option
                      v-for="preset in filteredBoardPresets(entry)"
                      :key="preset.key"
                      :value="preset.key"
                    >
                      {{ preset.name || preset.key }}
                    </option>
                  </select>
                  <button
                    type="button"
                    class="cfg-btn-secondary"
                    :disabled="hardwareOptionsLoading"
                    @click="loadHardwareOptions"
                  >
                    {{ hardwareOptionsLoading ? '...' : 'Refresh' }}
                  </button>
                </div>
                <p v-if="hardwareOptionsError" class="text-xs text-red-600 dark:text-red-400">
                  {{ hardwareOptionsError }}
                </p>
                <p class="text-xs text-content-muted dark:text-content-muted">
                  Optional: selecting a preset fills the pin fields below for quick setup changes.
                </p>
              </div>
            </div>

            <div class="text-xs text-content-muted dark:text-content-muted">SX1262 Board Pin Configuration</div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">SPI Bus ID
                <input v-if="isEditing" v-model.number="entry.sx1262.bus_id" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.bus_id }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">SPI CS ID
                <input v-if="isEditing" v-model.number="entry.sx1262.cs_id" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.cs_id }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">CS Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.cs_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.cs_pin }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Reset Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.reset_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.reset_pin }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Busy Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.busy_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.busy_pin }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">IRQ Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.irq_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.irq_pin }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">TX Enable Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.txen_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.txen_pin }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">RX Enable Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.rxen_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.rxen_pin }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Power Enable Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.en_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.en_pin }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">Power Enable Pins (array)
                <input
                  v-if="isEditing"
                  v-model="entry.sx1262.en_pins_input"
                  type="text"
                  class="cfg-input mt-1"
                  placeholder="26, 23"
                />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">
                  {{ entry.sx1262.en_pins_input || 'Not set' }}
                </span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">TX LED Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.txled_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.txled_pin }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">RX LED Pin
                <input v-if="isEditing" v-model.number="entry.sx1262.rxled_pin" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.sx1262.rxled_pin }}</span>
              </label>
            </div>
          </template>

          <template v-if="entry.radio_type === 'sx1262_ch341'">
            <div class="text-xs text-content-muted dark:text-content-muted">CH341 Adapter Configuration</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">CH341 VID
                <input v-if="isEditing" v-model.number="entry.ch341.vid" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.ch341.vid }}</span>
              </label>
              <label class="text-content-secondary dark:text-content-muted text-xs sm:text-sm">CH341 PID
                <input v-if="isEditing" v-model.number="entry.ch341.pid" type="number" class="cfg-input mt-1" />
                <span v-else class="block text-content-primary dark:text-content-primary font-mono text-sm mt-1">{{ entry.ch341.pid }}</span>
              </label>
            </div>
          </template>
        </div>
      </div>

      <div class="py-2 text-xs text-content-muted dark:text-content-muted">
        Saving writes the multi-radio configuration through config import and keeps first-radio legacy fields populated for compatibility.
      </div>
    </div>
  </div>
</template>
