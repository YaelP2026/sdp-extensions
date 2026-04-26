(function () {
  'use strict';

  const TARGET_WORKSPACE = '500';
  const METADATA_FIELDS_RESPONSE_FIELDS = [
    'is_user_defined', 'description', 'subtype', 'label', 'entity_type', 'name',
    'field_type', 'shared', 'creation_time', 'logical_name', 'name_alias',
    'version_stamp', 'aggregated_identifier', 'workspace_id', 'activity_level',
    'search_data_maintenance', 'applicable_4_search_ext', 'is_description_modified',
    'last_modified', 'visibility_setting_type', 'hide_field', 'is_searchable',
    'client_lock_stamp', 'trend_sync_status', 'supports_visibility_conf',
    'global_text_search_result', 'is_multivalue', 'show_for_roles', 'referenced_count',
    'is_trendable', 'referenced_entity_name'
  ].join(',');

  let entityCombo;
  let fieldCombo;

  const state = {
    params: {},
    strategyHint: null,
    entities: [],
    fieldsByEntity: new Map(),
    isBusy: false,
    lastAttemptSummary: ''
  };

  const ui = {
    warning: document.getElementById('workspace-warning'),
    labelInput: document.getElementById('label-input'),
    descriptionInput: document.getElementById('description-input'),
    saveButton: document.getElementById('save-button'),
    closeButton: document.getElementById('close-button'),
    status: document.getElementById('status')
  };

  function parseParams() {
    const addParam = (pair) => {
      if (!pair) return;
      const [name, value] = pair.split('=').map(decodeURIComponent);
      state.params[name] = value;
    };

    document.location.search.substring(1).split('&').forEach(addParam);
    document.location.hash.substring(1).split('&').forEach(addParam);
  }

  function workspaceApiBaseUrl() {
    return `${state.params.octane_url}/api/shared_spaces/${state.params.shared_space}/workspaces/${TARGET_WORKSPACE}`;
  }

  function sharedSpaceApiBaseUrl() {
    return `${state.params.octane_url}/api/shared_spaces/${state.params.shared_space}`;
  }

  function getXsrfValue() {
    const cookie = document.cookie.split('; ').find((row) => row.startsWith('XSRF_COOKIE='));
    return cookie ? cookie.split('=')[1] : state.params.xsrf_token;
  }

  async function octaneFetch(path, options = {}) {
    const scope = options.apiScope || 'workspace';
    const baseUrl = scope === 'shared_space' ? sharedSpaceApiBaseUrl() : workspaceApiBaseUrl();
    const requestOptions = { ...options };
    delete requestOptions.apiScope;

    const response = await fetch(`${baseUrl}${path}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'XSRF-HEADER': getXsrfValue(),
        'ALM-OCTANE-PRIVATE': 'true',
        ...(requestOptions.headers || {})
      },
      ...requestOptions
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};

    if (!response.ok) {
      const msg = payload.description || payload.description_translated || response.statusText || `HTTP ${response.status}`;
      const error = new Error(msg);
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  function postToOctane(message) {
    window.parent.postMessage(message, '*');
  }

  function setDialogTitle() {
    postToOctane({
      event_name: 'octane_set_dialog_title',
      workspace: state.params.workspace,
      shared_space: state.params.shared_space,
      data: {
        dialog_id: state.params.dialog_id,
        title: 'Update Field Label'
      }
    });
  }

  function closeDialog(refresh) {
    postToOctane({
      event_name: 'octane_close_dialog',
      workspace: state.params.workspace,
      shared_space: state.params.shared_space,
      data: {
        dialog_id: state.params.dialog_id,
        refresh: Boolean(refresh)
      }
    });
  }

  function refreshEntityLabelsGrid() {
    postToOctane({
      event_name: 'octane_refresh_list',
      workspace: state.params.workspace,
      shared_space: state.params.shared_space,
      data: {
        entity_type: 'entity_label'
      }
    });
  }

  function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  function uniqueValues(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function setStatus(message, kind) {
    ui.status.textContent = message || '';
    ui.status.classList.remove('success', 'error');
    ui.status.classList.toggle('hidden', !message);
    if (kind) {
      ui.status.classList.add(kind);
    }
  }

  function setBusy(value) {
    state.isBusy = value;
    const hasEntities = state.entities.length > 0;
    entityCombo.setEnabled(!value && hasEntities);
    const hasEntity = Boolean(entityCombo.getValue());
    const hasFields = hasEntity && (state.fieldsByEntity.get(entityCombo.getValue()) || []).length > 0;
    fieldCombo.setEnabled(!value && hasFields);
    ui.labelInput.disabled = value;
    ui.descriptionInput.disabled = value;
    updateSaveButtonState();
  }

  function matchesFilter(value, filterText) {
    if (!filterText) return true;
    return String(value || '').toLowerCase().includes(filterText.toLowerCase());
  }

  function updateSaveButtonState() {
    const canSave =
      !state.isBusy &&
      Boolean(entityCombo && entityCombo.getValue()) &&
      Boolean(fieldCombo && fieldCombo.getValue()) &&
      ui.labelInput.value.trim().length > 0 &&
      ui.descriptionInput.value.trim().length > 0;
    ui.saveButton.disabled = !canSave;
  }

  function renderWorkspaceWarning() {
    const currentWorkspace = state.params.workspace;
    if (currentWorkspace && currentWorkspace !== TARGET_WORKSPACE) {
      ui.warning.textContent = `This action always updates workspace ${TARGET_WORKSPACE}. Current context workspace is ${currentWorkspace}.`;
      ui.warning.classList.remove('hidden');
    }
  }

  function sortByName(a, b) {
    return a.name.localeCompare(b.name);
  }

  function entityIsVisibleInUi(entity) {
    if (!Array.isArray(entity.features)) {
      return false;
    }

    const restFeature = entity.features.find((feature) => feature.name === 'rest');
    return restFeature && ['PUBLIC', 'PUBLIC_TECH_PREVIEW'].includes(restFeature.access_level);
  }

  async function loadEntityTypes() {
    setStatus('Loading entity types...');
    const result = await octaneFetch('/metadata/entities?limit=1000');
    const entities = (result.data || [])
      .filter((entity) => entityIsVisibleInUi(entity))
      .map((entity) => ({ name: entity.name, label: entity.label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    state.entities = entities;
    entityCombo.setItems(entities.map((e) => ({ value: e.name, label: e.label })));
    entityCombo.setEnabled(true);
    setStatus('');
  }

  async function loadFieldsForEntity(entityName) {
    if (!entityName) {
      fieldCombo.clear();
      fieldCombo.setEnabled(false);
      return;
    }

    if (state.fieldsByEntity.has(entityName)) {
      const cachedFields = state.fieldsByEntity.get(entityName);
      fieldCombo.setItems(cachedFields.map((field) => ({
        value: field.metadataId,
        label: `${field.currentLabel} (${field.logicalName})`
      })));
      fieldCombo.setEnabled(true);
      setStatus('Enter a new label and update.');
      return;
    }

    setStatus(`Loading fields for ${entityName}...`);
    const query = encodeURIComponent(`\"entity_name='${entityName}';visible_in_ui EQ true\"`);
    const preferredFields = encodeURIComponent('id,name,label,aggregated_identifier,entity_type,logical_name');
    let result;
    try {
      result = await octaneFetch(`/metadata/fields?query=${query}&fields=${preferredFields}&limit=1000`);
    } catch (error) {
      const text = String(error.message || '').toLowerCase();
      if (!text.includes('does not have a field/s by name/s')) {
        throw error;
      }
      // Tenant metadata schema can vary; retry without projection and use available fields.
      result = await octaneFetch(`/metadata/fields?query=${query}&limit=1000`);
    }

    const fieldItems = (result.data || [])
      .map((field) => ({
        entityName,
        qualifiedLogicalName: `${entityName}.${field.name}`,
        aggregatedIdentifier: field.aggregated_identifier || `field.${entityName}.${field.name}`,
        metadataUuid: uniqueValues([
          field.uuid,
          field.field_uuid,
          field.id,
          field.uid
        ]).find(isUuidLike) || null,
        metadataId: String(field.id || field.uid || field.name),
        logicalName: field.name,
        currentLabel: field.label || field.name,
        currentDescription: field.description || ''
      }))
      .sort((a, b) => a.currentLabel.localeCompare(b.currentLabel));

    state.fieldsByEntity.set(entityName, fieldItems);
    fieldCombo.setItems(fieldItems.map((f) => ({ value: f.metadataId, label: `${f.currentLabel} (${f.logicalName})` })));
    fieldCombo.setEnabled(true);
    setStatus('');
  }

  function resolveFieldKey(selectedField, key) {
    if (key === 'resolvedMetadataFieldId') return selectedField.resolvedMetadataFieldId;
    if (key === 'logicalName') return selectedField.logicalName;
    if (key === 'qualifiedLogicalName') return selectedField.qualifiedLogicalName;
    if (key === 'aggregatedIdentifier') return selectedField.aggregatedIdentifier;
    if (key === 'metadataUuid') return selectedField.metadataUuid;
    if (key === 'metadataId') return selectedField.metadataId;
    return null;
  }

  function describeStrategy(strategy, fieldIdentifier, bodyIdentifier) {
    return [
      `${strategy.method} ${strategy.apiScope}/${strategy.endpointPrefix}`,
      `path=${strategy.pathKey}:${fieldIdentifier}`,
      `body.id=${strategy.bodyKey}:${bodyIdentifier}`,
      strategy.contract ? `contract=${strategy.contract}` : null
    ].join(' | ');
  }

  function buildRequestPath(strategy, selectedField, fieldIdentifier) {
    if (strategy.contract === 'octane-metadata-fields-exact') {
      const queryValue = `"(entity_type='${selectedField.entityName}')"`;
      const fieldsValue = METADATA_FIELDS_RESPONSE_FIELDS;
      return `/${strategy.endpointPrefix}/${encodeURIComponent(fieldIdentifier)}?fetch_single_entity=true&fields=${fieldsValue}&query=${queryValue}&visible_in_ui_or_cross_filterable=true&ALM-OCTANE-PRIVATE=true`;
    }

    return `/${strategy.endpointPrefix}/${encodeURIComponent(fieldIdentifier)}?visible_in_ui_or_cross_filterable=true&ALM-OCTANE-PRIVATE=true`;
  }

  async function updateFieldLabel(strategy, selectedField, newLabel, newDescription) {
    const fieldIdentifier = resolveFieldKey(selectedField, strategy.pathKey);
    const bodyIdentifier = resolveFieldKey(selectedField, strategy.bodyKey);
    if (!fieldIdentifier || !bodyIdentifier) {
      throw new Error(`Field identifier is missing for strategy ${strategy.endpointPrefix}/${strategy.pathKey}`);
    }

    const path = buildRequestPath(strategy, selectedField, fieldIdentifier);
    state.lastAttemptSummary = describeStrategy(strategy, fieldIdentifier, bodyIdentifier);

    return octaneFetch(path, {
      apiScope: strategy.apiScope,
      method: strategy.method,
      body: JSON.stringify({
        label: newLabel,
        description: newDescription,
        id: bodyIdentifier
      })
    });
  }

  function isRecoverableStrategyError(error) {
    if (error.status === 404 || error.status === 405) {
      return true;
    }
    const text = String(error.message || '').toLowerCase();
    return (
      text.includes('illegal value for uuid') ||
      text.includes('invalid value for uuid') ||
      text.includes('networkerror when attempting to fetch resource') ||
      text.includes('failed to fetch')
    );
  }

  async function resolveMetadataFieldId(selectedField) {
    if (selectedField.resolvedMetadataFieldId) {
      return selectedField.resolvedMetadataFieldId;
    }

    const rawQuery = `"(entity_type='${selectedField.entityName}';name='${selectedField.logicalName}')"`;
    const query = encodeURIComponent(rawQuery);
    const candidates = [
      `/metadata_fields?query=${query}&limit=1`,
      `/metadata_fields?query=${query}&fields=id,name,logical_name,entity_type&limit=1`
    ];

    for (const path of candidates) {
      try {
        const response = await octaneFetch(path, {
          apiScope: 'workspace',
          method: 'GET'
        });

        const item = Array.isArray(response.data) ? response.data[0] : response;
        const resolved = item && item.id ? String(item.id) : null;
        if (resolved) {
          selectedField.resolvedMetadataFieldId = resolved;
          return resolved;
        }
      } catch (error) {
        const text = String(error.message || '').toLowerCase();
        if (!(error.status === 404 || error.status === 405 || text.includes('general error'))) {
          throw error;
        }
      }
    }

    return null;
  }

  function buildUpdateStrategies(selectedField) {
    const baseStrategies = [
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'resolvedMetadataFieldId', bodyKey: 'resolvedMetadataFieldId', method: 'PUT', contract: 'octane-metadata-fields-exact' },
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'resolvedMetadataFieldId', bodyKey: 'resolvedMetadataFieldId', method: 'PATCH', contract: 'octane-metadata-fields-exact' },
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'aggregatedIdentifier', bodyKey: 'aggregatedIdentifier', method: 'PUT', contract: 'octane-metadata-fields-exact' },
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'aggregatedIdentifier', bodyKey: 'logicalName', method: 'PUT', contract: 'octane-metadata-fields-exact' },
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'metadataId', bodyKey: 'metadataId', method: 'PUT', contract: 'octane-metadata-fields-exact' },
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'metadataId', bodyKey: 'logicalName', method: 'PUT', contract: 'octane-metadata-fields-exact' },
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'logicalName', bodyKey: 'logicalName' },
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'qualifiedLogicalName', bodyKey: 'qualifiedLogicalName' },
      { apiScope: 'workspace', endpointPrefix: 'metadata_fields', pathKey: 'qualifiedLogicalName', bodyKey: 'logicalName' },
      { apiScope: 'shared_space', endpointPrefix: 'metadata_fields', pathKey: 'logicalName', bodyKey: 'logicalName' },
      { apiScope: 'shared_space', endpointPrefix: 'metadata_fields', pathKey: 'qualifiedLogicalName', bodyKey: 'qualifiedLogicalName' },
      { apiScope: 'shared_space', endpointPrefix: 'metadata_fields', pathKey: 'qualifiedLogicalName', bodyKey: 'logicalName' },
      { apiScope: 'shared_space', endpointPrefix: 'metadata/fields', pathKey: 'metadataUuid', bodyKey: 'metadataUuid' },
      { apiScope: 'workspace', endpointPrefix: 'metadata/fields', pathKey: 'metadataUuid', bodyKey: 'metadataUuid' },
      { apiScope: 'shared_space', endpointPrefix: 'metadata/fields', pathKey: 'metadataUuid', bodyKey: 'logicalName' },
      { apiScope: 'workspace', endpointPrefix: 'metadata/fields', pathKey: 'metadataUuid', bodyKey: 'logicalName' },
      { apiScope: 'shared_space', endpointPrefix: 'metadata/fields', pathKey: 'metadataId', bodyKey: 'metadataId' },
      { apiScope: 'workspace', endpointPrefix: 'metadata/fields', pathKey: 'metadataId', bodyKey: 'metadataId' },
      { apiScope: 'shared_space', endpointPrefix: 'metadata/fields', pathKey: 'metadataId', bodyKey: 'logicalName' },
      { apiScope: 'workspace', endpointPrefix: 'metadata/fields', pathKey: 'metadataId', bodyKey: 'logicalName' },
      { apiScope: 'shared_space', endpointPrefix: 'metadata/fields', pathKey: 'logicalName', bodyKey: 'logicalName' },
      { apiScope: 'workspace', endpointPrefix: 'metadata/fields', pathKey: 'logicalName', bodyKey: 'logicalName' }
    ];

    const strategies = [];
    baseStrategies.forEach((strategy) => {
      if (strategy.method) {
        strategies.push(strategy);
        return;
      }

      ['PUT', 'PATCH'].forEach((method) => {
        strategies.push({ ...strategy, method });
      });
    });

    return strategies.filter((strategy) => (
      resolveFieldKey(selectedField, strategy.pathKey) &&
      resolveFieldKey(selectedField, strategy.bodyKey)
    ));
  }

  async function updateWithEndpointDetection(selectedField, newLabel, newDescription) {
    const strategies = buildUpdateStrategies(selectedField);

    if (state.strategyHint) {
      strategies.unshift(state.strategyHint);
    }

    const deduped = [];
    const seen = new Set();
    strategies.forEach((strategy) => {
      const key = `${strategy.method}|${strategy.apiScope}|${strategy.endpointPrefix}|${strategy.pathKey}|${strategy.bodyKey}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(strategy);
      }
    });

    let lastError;
    for (const strategy of deduped) {
      try {
        const response = await updateFieldLabel(strategy, selectedField, newLabel, newDescription);
        state.strategyHint = strategy;
        return response;
      } catch (error) {
        lastError = error;
        if (!isRecoverableStrategyError(error)) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Unable to find a supported metadata update endpoint.');
  }

  async function onEntityChanged(entityName) {
    fieldCombo.setEnabled(false);
    fieldCombo.clear();
    ui.labelInput.value = '';
    ui.descriptionInput.value = '';
    updateSaveButtonState();

    if (!entityName) return;

    try {
      await loadFieldsForEntity(entityName);
    } catch (error) {
      setStatus(`Failed to load fields: ${error.message}`, 'error');
    }
  }

  function onFieldChanged(fieldId) {
    const entityName = entityCombo.getValue();
    const fields = state.fieldsByEntity.get(entityName) || [];
    const selectedField = fields.find((f) => f.metadataId === fieldId);
    if (selectedField) {
      ui.labelInput.value = selectedField.currentLabel;
      ui.descriptionInput.value = selectedField.currentDescription;
    }
    updateSaveButtonState();
  }

  async function onSaveClicked() {
    const entityName = entityCombo.getValue();
    const fieldId = fieldCombo.getValue();
    const newLabel = ui.labelInput.value.trim();
    const newDescription = ui.descriptionInput.value.trim();
    const fields = state.fieldsByEntity.get(entityName) || [];
    const selectedField = fields.find((f) => f.metadataId === fieldId);

    if (!entityName || !selectedField || !newLabel || !newDescription) {
      setStatus('Please select entity and field, then provide a label and description.', 'error');
      return;
    }

    setBusy(true);
    setStatus('Updating label...');

    try {
      await resolveMetadataFieldId(selectedField);
      await updateWithEndpointDetection(selectedField, newLabel, newDescription);

      if (selectedField) {
        selectedField.currentLabel = newLabel;
        selectedField.currentDescription = newDescription;
      }

      setStatus(`Label and description updated for ${selectedField.logicalName}. You can update another field or close dialog.`, 'success');
      refreshEntityLabelsGrid();
    } catch (error) {
      const details = state.lastAttemptSummary ? ` Last attempt: ${state.lastAttemptSummary}` : '';
      setStatus(`Update failed: ${error.message}.${details}`, 'error');
    } finally {
      setBusy(false);
      updateSaveButtonState();
    }
  }

  function createCombobox(container, { placeholder = 'Select...', searchPlaceholder = 'Search...' } = {}) {
    let allItems = [];
    let selectedValue = '';
    let changeCallback = () => {};

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'combo__trigger combo__trigger--placeholder';
    trigger.textContent = placeholder;
    trigger.disabled = true;

    const panel = document.createElement('div');
    panel.className = 'combo__panel';
    panel.hidden = true;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'combo__search';
    searchInput.placeholder = searchPlaceholder;

    const list = document.createElement('ul');
    list.className = 'combo__list';

    panel.appendChild(searchInput);
    panel.appendChild(list);
    container.className = 'combo';
    container.appendChild(trigger);
    container.appendChild(panel);

    function renderList(filterText) {
      const lower = (filterText || '').toLowerCase();
      const filtered = lower
        ? allItems.filter((item) => item.label.toLowerCase().includes(lower))
        : allItems;

      list.innerHTML = '';
      if (!filtered.length) {
        const li = document.createElement('li');
        li.className = 'combo__item combo__item--empty';
        li.textContent = lower ? 'No matches' : 'No items';
        list.appendChild(li);
        return;
      }

      filtered.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'combo__item' + (item.value === selectedValue ? ' combo__item--selected' : '');
        li.textContent = item.label;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectItem(item);
        });
        list.appendChild(li);
      });
    }

    function openPanel() {
      panel.hidden = false;
      searchInput.value = '';
      renderList('');
      searchInput.focus();
    }

    function closePanel() {
      panel.hidden = true;
    }

    function selectItem(item) {
      selectedValue = item.value;
      trigger.textContent = item.label;
      trigger.classList.remove('combo__trigger--placeholder');
      closePanel();
      changeCallback(item.value);
    }

    trigger.addEventListener('click', () => {
      if (trigger.disabled) return;
      panel.hidden ? openPanel() : closePanel();
    });

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

    document.addEventListener('mousedown', (e) => {
      if (!container.contains(e.target)) closePanel();
    });

    return {
      getValue() { return selectedValue; },
      setItems(items) {
        allItems = items;
        if (selectedValue && !items.some((i) => i.value === selectedValue)) {
          selectedValue = '';
          trigger.textContent = placeholder;
          trigger.classList.add('combo__trigger--placeholder');
        }
        if (!panel.hidden) renderList(searchInput.value);
      },
      clear() {
        allItems = [];
        selectedValue = '';
        trigger.textContent = placeholder;
        trigger.classList.add('combo__trigger--placeholder');
        panel.hidden = true;
      },
      setEnabled(enabled) {
        trigger.disabled = !enabled;
      },
      onChange(cb) {
        changeCallback = cb;
      }
    };
  }

  function bindEvents() {
    entityCombo.onChange(onEntityChanged);
    fieldCombo.onChange(onFieldChanged);
    ui.labelInput.addEventListener('input', updateSaveButtonState);
    ui.descriptionInput.addEventListener('input', updateSaveButtonState);
    ui.saveButton.addEventListener('click', onSaveClicked);
    ui.closeButton.addEventListener('click', () => closeDialog(false));
  }

  async function init() {
    parseParams();
    setDialogTitle();
    renderWorkspaceWarning();

    entityCombo = createCombobox(document.getElementById('entity-combo'), {
      placeholder: 'Select entity type',
      searchPlaceholder: 'Search entities...'
    });
    fieldCombo = createCombobox(document.getElementById('field-combo'), {
      placeholder: 'Select field',
      searchPlaceholder: 'Search fields...'
    });

    bindEvents();

    setBusy(true);
    try {
      await loadEntityTypes();
    } catch (error) {
      setStatus(`Failed to load entity types: ${error.message}`, 'error');
    } finally {
      setBusy(false);
      updateSaveButtonState();
    }
  }

  init();
})();
