import mermaid from 'mermaid';

const params = {};
let features = [];

const ui = {
  status: document.getElementById('status'),
  selectorWrap: document.getElementById('selector-wrap'),
  featureSelect: document.getElementById('feature-select'),
  meta: document.getElementById('meta'),
  diagramWrap: document.getElementById('diagram-wrap'),
  diagram: document.getElementById('diagram'),
  empty: document.getElementById('empty'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  zoomReset: document.getElementById('zoom-reset')
};

let zoomLevel = 1;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

function applyZoom() {
  ui.diagram.style.zoom = zoomLevel;
  ui.zoomReset.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function resetZoom() {
  zoomLevel = 1;
  applyZoom();
}

function addParam(paramPair) {
  if (!paramPair) {
    return;
  }

  const [name, value] = paramPair.split('=').map(decodeURIComponent);
  params[name] = value;
}

function parseParams() {
  Object.keys(params).forEach((key) => delete params[key]);
  document.location.search.substring(1).split('&').forEach(addParam);
  document.location.hash.substring(1).split('&').forEach(addParam);
}

function getSelectedIds() {
  if (!params.entity_ids) {
    return [];
  }

  return params.entity_ids
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function setStatus(message) {
  ui.status.textContent = message;
  ui.status.classList.remove('hidden');
}

function hideStatus() {
  ui.status.classList.add('hidden');
}

function setEmpty(message) {
  ui.empty.textContent = message;
  ui.empty.classList.remove('hidden');
  ui.diagramWrap.classList.add('hidden');
}

function clearEmpty() {
  ui.empty.classList.add('hidden');
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function normalizeMermaidSource(rawValue) {
  let text = (rawValue || '').trim();
  if (!text) {
    return '';
  }

  // Extract code block content when the UDF is stored as rich text HTML.
  const preCodeMatch = text.match(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i);
  if (preCodeMatch) {
    text = preCodeMatch[1];
  }

  // Fallback for HTML content outside pre/code.
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h\d>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  text = decodeHtmlEntities(text).replace(/\u00a0/g, ' ');

  // Support fenced markdown blocks pasted into the field.
  const fencedBlock = text.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
  if (fencedBlock) {
    text = fencedBlock[1];
  }

  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function safeMermaidLabel(label) {
  // Replace problematic characters with visually-similar Unicode equivalents
  // that won't break Mermaid's parser
  label = label.replace(/\n/g, ' ');
  // Replace parens with full-width variants: ( → （, ) → ）
  label = label.replace(/\(/g, '（');
  label = label.replace(/\)/g, '）');
  // Replace pipe with space
  label = label.replace(/\|/g, ' ');
  // Replace curly braces with full-width variants
  label = label.replace(/{/g, '｛');
  label = label.replace(/}/g, '｝');
  // Replace square brackets with full-width (for content, not syntax)
  // Only if they're not part of the node label syntax itself
  return label;
}

function sanitizeMermaidSyntax(source) {
  // Replace content inside node labels [text] with safer punctuation
  return source
    .split('\n')
    .map((line) => {
      // Match [label] and replace problematic chars inside
      return line.replace(/\[([^\[\]]*?)\]/g, (match, label) => {
        const safe = safeMermaidLabel(label);
        return `[${safe}]`;
      });
    })
    .join('\n');
}

function baseApiUrl() {
  return `${params.octane_url}/api/shared_spaces/${params.shared_space}/workspaces/${params.workspace}`;
}

async function fetchFeatures(featureIds) {
  if (featureIds.length === 0) {
    return [];
  }

  const query = `"(id IN ${featureIds.join(',')};subtype EQ 'feature')"`;
  const url = `${baseApiUrl()}/work_items?query=${encodeURIComponent(query)}&fields=id,name,mermaid_udf&limit=1000`;

  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.description || error.description_translated || response.statusText);
  }

  const result = await response.json();
  return result.data || [];
}

function buildSelector(items) {
  ui.featureSelect.innerHTML = '';

  items.forEach((feature, index) => {
    const option = document.createElement('option');
    option.value = feature.id;
    option.textContent = `#${feature.id} ${feature.name || ''}`.trim();
    if (index === 0) {
      option.selected = true;
    }
    ui.featureSelect.appendChild(option);
  });

  ui.selectorWrap.classList.toggle('hidden', items.length <= 1);
}

async function renderFeature(featureId) {
  const feature = features.find((item) => String(item.id) === String(featureId));

  if (!feature) {
    setEmpty('Selected feature was not found.');
    ui.meta.classList.add('hidden');
    return;
  }

  const source = normalizeMermaidSource(feature.mermaid_udf);
  ui.meta.textContent = `Feature #${feature.id} ${feature.name || ''}`.trim();
  ui.meta.classList.remove('hidden');

  if (!source) {
    setEmpty(`Feature #${feature.id} has no value in mermaid_udf.`);
    return;
  }

  clearEmpty();
  resetZoom();
  ui.diagramWrap.classList.remove('hidden');

  try {
    const sanitized = sanitizeMermaidSyntax(source);
    const renderId = `mermaid-${feature.id}-${Date.now()}`;
    const { svg, bindFunctions } = await mermaid.render(renderId, sanitized);
    ui.diagram.innerHTML = svg;
    if (bindFunctions) {
      bindFunctions(ui.diagram);
    }
  } catch (error) {
    ui.diagramWrap.classList.add('hidden');
    setEmpty(`Failed to render Mermaid for feature #${feature.id}: ${error.message}`);
  }
}

async function load() {
  parseParams();
  setStatus('Loading features...');
  clearEmpty();
  ui.diagram.innerHTML = '';
  ui.meta.classList.add('hidden');

  const ids = getSelectedIds();
  if (ids.length === 0) {
    setEmpty('No feature is selected. Select one or more features and reopen the panel.');
    return;
  }

  try {
    features = await fetchFeatures(ids);

    if (features.length === 0) {
      setEmpty('No features found for the current selection.');
      return;
    }

    buildSelector(features);
    hideStatus();
    await renderFeature(features[0].id);
  } catch (error) {
    setEmpty(`Failed to load features: ${error.message}`);
  }
}

ui.featureSelect.addEventListener('change', async (event) => {
  await renderFeature(event.target.value);
});

ui.zoomIn.addEventListener('click', () => {
  zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(2));
  applyZoom();
});

ui.zoomOut.addEventListener('click', () => {
  zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(2));
  applyZoom();
});

ui.zoomReset.addEventListener('click', () => {
  resetZoom();
});

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'antiscript'
});

window.addEventListener('hashchange', load);
load();
