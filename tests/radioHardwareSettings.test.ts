import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const fetchStatsMock = vi.fn().mockResolvedValue(undefined);

if (typeof Storage === 'undefined') {
  class StorageMock {
    private data = new Map<string, string>();

    getItem(key: string) {
      return this.data.has(key) ? this.data.get(key)! : null;
    }

    setItem(key: string, value: string) {
      this.data.set(key, String(value));
    }

    removeItem(key: string) {
      this.data.delete(key);
    }

    clear() {
      this.data.clear();
    }
  }

  vi.stubGlobal('Storage', StorageMock);
}

if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
  const storage = new Storage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
}

vi.mock('@/utils/api', () => ({
  ApiService: {
    get: vi.fn(),
    getSerialPorts: vi.fn(),
    importConfig: vi.fn(),
  },
  default: {
    get: vi.fn(),
    getSerialPorts: vi.fn(),
    importConfig: vi.fn(),
  },
}));

vi.mock('@/stores/system', () => ({
  useSystemStore: () => ({
    stats: {
      config: {
        radios: [
          {
            name: 'bridge-a',
            enabled: true,
            radio_type: 'kiss',
            kiss: { port: '/dev/ttyUSB0', baud_rate: 9600 },
          },
          {
            name: 'bridge-b',
            enabled: false,
            radio_type: 'pymc_tcp',
            pymc_tcp: { host: 'mesh.local', port: 5055, token: 'abc123' },
          },
        ],
      },
    },
    fetchStats: fetchStatsMock,
  }),
}));

vi.mock('@/composables/useUnsavedChanges', () => ({
  useUnsavedChanges: () => ({
    showUnsavedModal: false,
    requestLeave: vi.fn().mockResolvedValue(true),
    handleDiscard: vi.fn(),
    handleSave: vi.fn(),
    handleCancel: vi.fn(),
  }),
}));

import ApiService, { ApiService as NamedApiService } from '@/utils/api';
import RadioHardwareSettings from '@/components/configuration/RadioHardwareSettings.vue';

function mountComponent() {
  return mount(RadioHardwareSettings, {
    global: {
      stubs: { UnsavedChangesModal: true, RestartModal: true },
      plugins: [createPinia()],
    },
  });
}

describe('RadioHardwareSettings multi-radio support', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(ApiService.get).mockResolvedValue({ hardware: [] } as any);
    vi.mocked(ApiService.getSerialPorts).mockResolvedValue({
      success: true,
      data: [{ device: '/dev/ttyUSB0', description: 'USB Modem' }],
    } as any);
    vi.mocked(NamedApiService.get).mockResolvedValue({ hardware: [] } as any);
    vi.mocked(NamedApiService.getSerialPorts).mockResolvedValue({
      success: true,
      data: [{ device: '/dev/ttyUSB0', description: 'USB Modem' }],
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders multiple configured radio entries from stats.config.radios', async () => {
    const wrapper = mountComponent();
    await flushPromises();

    expect(wrapper.text()).toContain('Radio 1');
    expect(wrapper.text()).toContain('Radio 2');
    expect(wrapper.text()).toContain('bridge-a');
    expect(wrapper.text()).toContain('bridge-b');
    expect(wrapper.text()).toContain('#1 bridge-a (enabled): kiss - KISS-modem over serial');
    expect(wrapper.text()).toContain('#2 bridge-b (disabled): pymc_tcp - pymc_tcp firmware modem over Wi-Fi/TCP');
  });

  it('shows editable radio names and enabled state for each entry', async () => {
    const wrapper = mountComponent();
    await flushPromises();

    const editButton = wrapper.findAll('button').find((b) => b.text().includes('Edit Settings'));
    await editButton!.trigger('click');
    await flushPromises();

    const nameInputs = wrapper.findAll('input[placeholder^="radio"]');
    expect(nameInputs).toHaveLength(2);
    expect((nameInputs[0].element as HTMLInputElement).value).toBe('bridge-a');
    expect((nameInputs[1].element as HTMLInputElement).value).toBe('bridge-b');

    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    expect(checkboxes.some((box) => (box.element as HTMLInputElement).checked)).toBe(true);
    expect(checkboxes.some((box) => !(box.element as HTMLInputElement).checked)).toBe(true);
  });

  it('allows adding and removing radio entries while editing', async () => {
    const wrapper = mountComponent();
    await flushPromises();

    const editButton = wrapper.findAll('button').find((b) => b.text().includes('Edit Settings'));
    await editButton!.trigger('click');
    await flushPromises();

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('Add Radio'));
    await addButton!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Radio 3');

    const removeButtons = wrapper.findAll('button').filter((b) => b.text().includes('Remove'));
    await removeButtons[2].trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Radio 3');
  });

  it('saves radios via config import with legacy fields synchronized to the selected active radio', async () => {
    vi.mocked(ApiService.importConfig).mockResolvedValue({ success: true } as any);
    vi.mocked(NamedApiService.importConfig).mockResolvedValue({ success: true } as any);

    const wrapper = mountComponent();
    await flushPromises();

    const editButton = wrapper.findAll('button').find((b) => b.text().includes('Edit Settings'));
    await editButton!.trigger('click');
    await flushPromises();

    const firstEntry = wrapper.find('[data-testid="radio-entry-0"]');
    await firstEntry.find('select').setValue('sx1262_ch341');
    await flushPromises();

    const hostInput = wrapper
      .find('[data-testid="radio-entry-1"]')
      .find('input[placeholder="pymc-3e2834.local"]');
    await hostInput.setValue('radio2.local');

    const saveButton = wrapper.findAll('button').find((b) => b.text().includes('Save Changes'));
    await saveButton!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('TCP modem host is required');
    expect(NamedApiService.importConfig).toHaveBeenCalledTimes(1);
    expect(NamedApiService.importConfig).toHaveBeenCalledWith({
      name: 'bridge-a',
      enabled: true,
      radio_type: 'sx1262_ch341',
      sx1262: {
        bus_id: 0,
        cs_id: 0,
        cs_pin: 21,
        reset_pin: 18,
        busy_pin: 20,
        irq_pin: 16,
        txen_pin: -1,
        rxen_pin: -1,
        en_pins: [0],
        txled_pin: -1,
        rxled_pin: -1,
      },
      ch341: {
        vid: 6790,
        pid: 21778,
      },
      radios: [
        {
          name: 'bridge-a',
          enabled: true,
          radio_type: 'sx1262_ch341',
          sx1262: {
            bus_id: 0,
            cs_id: 0,
            cs_pin: 21,
            reset_pin: 18,
            busy_pin: 20,
            irq_pin: 16,
            txen_pin: -1,
            rxen_pin: -1,
            en_pins: [0],
            txled_pin: -1,
            rxled_pin: -1,
          },
          ch341: {
            vid: 6790,
            pid: 21778,
          },
        },
        {
          name: 'bridge-b',
          enabled: false,
          radio_type: 'pymc_tcp',
          pymc_tcp: {
            host: 'radio2.local',
            port: 5055,
            token: 'abc123',
          },
        },
      ],
    });
    expect(fetchStatsMock).toHaveBeenCalled();
  });

  it('keeps legacy payload fields aligned with the first enabled radio when the first entry is disabled', async () => {
    vi.mocked(ApiService.importConfig).mockResolvedValue({ success: true } as any);
    vi.mocked(NamedApiService.importConfig).mockResolvedValue({ success: true } as any);

    const wrapper = mountComponent();
    await flushPromises();

    const editButton = wrapper.findAll('button').find((b) => b.text().includes('Edit Settings'));
    await editButton!.trigger('click');
    await flushPromises();

    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    await checkboxes[0].setValue(false);
    await flushPromises();

    const hostInput = wrapper
      .find('[data-testid="radio-entry-1"]')
      .find('input[placeholder="pymc-3e2834.local"]');
    await hostInput.setValue('active-room.local');

    const saveButton = wrapper.findAll('button').find((b) => b.text().includes('Save Changes'));
    await saveButton!.trigger('click');
    await flushPromises();

    expect(NamedApiService.importConfig).toHaveBeenCalledWith({
      name: 'bridge-a',
      enabled: false,
      radio_type: 'kiss',
      kiss: {
        port: '/dev/ttyUSB0',
        baud_rate: 9600,
      },
      radios: [
        {
          name: 'bridge-a',
          enabled: false,
          radio_type: 'kiss',
          kiss: {
            port: '/dev/ttyUSB0',
            baud_rate: 9600,
          },
        },
        {
          name: 'bridge-b',
          enabled: false,
          radio_type: 'pymc_tcp',
          pymc_tcp: {
            host: 'active-room.local',
            port: 5055,
            token: 'abc123',
          },
        },
      ],
    });
  });
});
