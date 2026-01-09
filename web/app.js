const DATA_URL = "/data/graph.json";
const ONTOLOGY_URL = "/ontology/ontology.json";

// Import Transformers.js dynamically - using proper pipeline import as per docs
let pipeline = null;
let env = null;
let qaPipeline = null;
let transformersPromise = null;

// Model configuration for easy future updates
const MODEL_CONFIG = {
  qa: {
    name: 'Xenova/distilbert-base-cased-distilled-squad',
    task: 'question-answering',
    size: '~250MB',
    url: 'https://huggingface.co/Xenova/distilbert-base-cased-distilled-squad'
  }
};

async function loadTransformers() {
  if (pipeline) {
    return { pipeline, env };
  }
  
  if (transformersPromise) {
    return transformersPromise;
  }
  
  transformersPromise = (async () => {
    try {
      const module = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      pipeline = module.pipeline;
      env = module.env;
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      return { pipeline, env };
    } catch (error) {
      console.error("Failed to load Transformers.js:", error);
      transformersPromise = null;
      throw error;
    }
  })();
  
  return transformersPromise;
}

async function checkWebGPU() {
  if ('gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    } catch {
      return false;
    }
  }
  return false;
}

async function showModelConsentModal(modelInfo) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Load AI Model</h2>
        </div>
        <div class="modal-body">
          <p>This feature requires downloading an AI model:</p>
          <ul style="margin: 16px 0; padding-left: 24px;">
            <li><strong>Model:</strong> ${modelInfo.name}</li>
            <li><strong>Size:</strong> ${modelInfo.size}</li>
            <li><strong>Task:</strong> ${modelInfo.task}</li>
          </ul>
          <p>The model will be downloaded once and cached in your browser for future use.</p>
          <p style="margin-top: 12px;">
            <a href="${modelInfo.url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent);">
              View model card on Hugging Face →
            </a>
          </p>
        </div>
        <div class="button-group" style="margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end;">
          <button class="clear-btn" id="cancelModel">Cancel</button>
          <button class="primary-btn" id="acceptModel">Download and Continue</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('cancelModel').onclick = () => {
      document.body.removeChild(modal);
      resolve(false);
    };
    
    document.getElementById('acceptModel').onclick = () => {
      document.body.removeChild(modal);
      resolve(true);
    };
    
    modal.onclick = (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
        resolve(false);
      }
    };
  });
}

const palette = [
  "#d95f4c",
  "#4c7fd9",
  "#4cbf88",
  "#d9a64c",
  "#7a5fd9",
  "#d94c7a",
  "#4cbfd1",
  "#a65fd9",
];

const state = {
  ontology: null,
  graph: null,
  view: "graph",
  filter: "All",
  focusId: null,
  searchTerm: "",
  searchDepth: 2,
  maxDepthSentinel: 6,
};

const statusEl = document.getElementById("status");
const graphView = document.getElementById("graphView");
const tableView = document.getElementById("tableView");
const classFilter = document.getElementById("classFilter");
const clearFiltersBtn = document.getElementById("clearFilters");
const searchInput = document.getElementById("searchInput");
const depthRange = document.getElementById("depthRange");
const depthValue = document.getElementById("depthValue");
const viewOntologyBtn = document.getElementById("viewOntology");
const exportViewBtn = document.getElementById("exportView");
const ontologyModal = document.getElementById("ontologyModal");
const ontologyContent = document.getElementById("ontologyContent");
const closeOntologyBtn = document.getElementById("closeOntology");
const qaInput = document.getElementById("qaInput");
const askBtn = document.getElementById("askBtn");
const qaModal = document.getElementById("qaModal");
const qaResult = document.getElementById("qaResult");
const closeQABtn = document.getElementById("closeQA");

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function fetchJson(url) {
  return fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(`Failed to load ${url}`);
    }
    return res.json();
  });
}

function classColorMap(classes) {
  const map = new Map();
  classes.forEach((cls, idx) => {
    map.set(cls, palette[idx % palette.length]);
  });
  return map;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateStatus() {
  const classCount = state.ontology.classes.length;
  const nodeCount = state.graph.nodes.length;
  const edgeCount = state.graph.edges.length;
  const now = new Date().toLocaleTimeString();
  const focusLabel = state.focusId ? nodeLabel(nodeById(state.focusId)) : "None";
  const searchLabel = state.searchTerm ? `"${state.searchTerm}"` : "None";
  const depthLabel =
    state.searchDepth === Infinity ? "∞" : String(state.searchDepth);
  setStatus(
    `Classes: ${classCount} | Nodes: ${nodeCount} | Edges: ${edgeCount}\nFocus: ${focusLabel} | Search: ${searchLabel} | Depth: ${depthLabel}\nUpdated: ${now}`
  );
}

function buildFilter() {
  classFilter.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "All";
  allOption.textContent = "All classes";
  classFilter.appendChild(allOption);

  state.ontology.classes.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.name;
    option.textContent = entry.label || entry.name;
    classFilter.appendChild(option);
  });

  classFilter.value = state.filter;
  classFilter.addEventListener("change", (event) => {
    state.filter = event.target.value;
    render();
  });
}

function nodeById(id) {
  return state.graph.nodes.find((node) => node.id === id);
}

function nodeLabel(node) {
  if (!node) {
    return "Unknown";
  }
  const props = node.properties || {};
  return (
    props.name ||
    props.fullName ||
    props.handle ||
    props.actionType ||
    props.campaignType ||
    props.platform ||
    props.url ||
    node.id.slice(0, 6)
  );
}

function relatedNodeIds() {
  if (!state.focusId) {
    return null;
  }
  return expandFromIds([state.focusId], 1);
}

function neighborMap() {
  const map = new Map();
  state.graph.edges.forEach((edge) => {
    if (!map.has(edge.from)) {
      map.set(edge.from, new Set());
    }
    if (!map.has(edge.to)) {
      map.set(edge.to, new Set());
    }
    map.get(edge.from).add(edge.to);
    map.get(edge.to).add(edge.from);
  });
  return map;
}

function expandFromIds(ids, depth) {
  const neighbors = neighborMap();
  const visited = new Set(ids);
  let frontier = new Set(ids);
  const maxSteps = depth === Infinity ? state.graph.edges.length : depth;
  for (let step = 0; step < maxSteps; step += 1) {
    const next = new Set();
    frontier.forEach((id) => {
      const targets = neighbors.get(id);
      if (!targets) {
        return;
      }
      targets.forEach((target) => {
        if (!visited.has(target)) {
          visited.add(target);
          next.add(target);
        }
      });
    });
    frontier = next;
    if (!frontier.size) {
      break;
    }
  }
  return visited;
}

function searchMatches() {
  if (!state.searchTerm) {
    return null;
  }
  const term = state.searchTerm.toLowerCase();
  const matches = state.graph.nodes.filter((node) => {
    const props = node.properties || {};
    const values = [node.class, node.id, ...Object.values(props)];
    return values.some((value) =>
      String(value || "").toLowerCase().includes(term)
    );
  });
  return matches.map((node) => node.id);
}

function filteredNodes() {
  let nodes = [...state.graph.nodes];
  const related = relatedNodeIds();
  const matches = searchMatches();
  let idSet = null;

  if (related) {
    idSet = related;
  }
  if (matches && matches.length) {
    const expanded = expandFromIds(matches, state.searchDepth);
    idSet = idSet
      ? new Set([...idSet].filter((id) => expanded.has(id)))
      : expanded;
  }
  if (idSet) {
    nodes = nodes.filter((node) => idSet.has(node.id));
  }
  if (state.filter !== "All") {
    nodes = nodes.filter((node) => node.class === state.filter);
  }
  return nodes;
}

function filteredEdges(nodeIds) {
  return state.graph.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)
  );
}

function applicableProperties(className, kind) {
  return state.ontology.properties.filter((prop) => {
    if (prop.kind !== kind) {
      return false;
    }
    const domains = prop.domain || [];
    return domains.includes(className) || domains.includes("owl:Thing");
  });
}

function renderLegend(classes, colorMap) {
  const legend = document.createElement("div");
  legend.className = "legend";
  classes.forEach((cls) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = colorMap.get(cls) || "#999";
    const label = document.createElement("span");
    label.textContent = cls;
    item.appendChild(swatch);
    item.appendChild(label);
    legend.appendChild(item);
  });
  return legend;
}

function renderGraph() {
  graphView.innerHTML = "";
  const nodes = filteredNodes();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = filteredEdges(nodeIds);

  if (!nodes.length) {
    graphView.textContent = "No nodes to display.";
    return;
  }

  const classes = [...new Set(nodes.map((node) => node.class))];
  const colors = classColorMap(classes);
  graphView.appendChild(renderLegend(classes, colors));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "graph-canvas");
  svg.setAttribute("viewBox", "0 0 900 420");

  const positions = new Map();
  const classCenters = new Map();
  const centerX = 450;
  const centerY = 210;
  const classRadius = 160;

  classes.forEach((cls, idx) => {
    const angle = (Math.PI * 2 * idx) / classes.length;
    classCenters.set(cls, {
      x: centerX + Math.cos(angle) * classRadius,
      y: centerY + Math.sin(angle) * classRadius,
    });
  });

  classes.forEach((cls) => {
    const classNodes = nodes.filter((node) => node.class === cls);
    const localRadius = Math.max(40, 10 * classNodes.length);
    const center = classCenters.get(cls);
    classNodes.forEach((node, idx) => {
      const angle = (Math.PI * 2 * idx) / classNodes.length;
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * localRadius,
        y: center.y + Math.sin(angle) * localRadius,
      });
    });
  });

  edges.forEach((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) {
      return;
    }
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", from.x);
    line.setAttribute("y1", from.y);
    line.setAttribute("x2", to.x);
    line.setAttribute("y2", to.y);
    line.setAttribute("stroke", "#8a7b6a");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", (from.x + to.x) / 2);
    label.setAttribute("y", (from.y + to.y) / 2);
    label.setAttribute("fill", "#6c625a");
    label.setAttribute("font-size", "10");
    label.textContent = edge.type;
    svg.appendChild(label);
  });

  nodes.forEach((node) => {
    const pos = positions.get(node.id);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.style.cursor = "pointer";
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", "16");
    circle.setAttribute("fill", colors.get(node.class) || "#999");
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", "2");

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", pos.x);
    label.setAttribute("y", pos.y + 32);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#3a2f25");
    label.textContent = nodeLabel(node);

    group.appendChild(circle);
    group.appendChild(label);
    svg.appendChild(group);

    group.addEventListener("click", () => {
      state.focusId = node.id;
      render();
    });
  });

  graphView.appendChild(svg);
}

function renderTables() {
  tableView.innerHTML = "";
  const classes = state.ontology.classes
    .map((entry) => entry.name)
    .filter((name) => state.filter === "All" || name === state.filter);

  classes.forEach((className) => {
    const section = document.createElement("section");
    section.className = "table-section";

    const title = document.createElement("h2");
    title.textContent = className;
    section.appendChild(title);

    const nodes = filteredNodes().filter((node) => node.class === className);
    if (!nodes.length) {
      const empty = document.createElement("p");
      empty.textContent = "No entries yet.";
      section.appendChild(empty);
      tableView.appendChild(section);
      return;
    }

    const dataProps = applicableProperties(className, "datatype");
    const columns = ["id", ...dataProps.map((prop) => prop.name)];

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    nodes.forEach((node) => {
      const row = document.createElement("tr");
      row.dataset.nodeId = node.id;
      columns.forEach((col) => {
        const cell = document.createElement("td");
        if (col === "id") {
          cell.textContent = node.id.slice(0, 8);
        } else {
          cell.textContent = node.properties[col] || "";
        }
        row.appendChild(cell);
      });
      row.addEventListener("click", () => {
        state.focusId = node.id;
        render();
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    section.appendChild(table);
    tableView.appendChild(section);
  });
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function exportGraphView() {
  const nodes = filteredNodes();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = filteredEdges(nodeIds);
  if (!nodes.length) {
    alert("No nodes to export in the current view.");
    return;
  }
  const payload = { nodes, edges };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sintology-graph-view.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportTableView() {
  const nodes = filteredNodes();
  if (!nodes.length) {
    alert("No nodes to export in the current view.");
    return;
  }
  const allProps = new Set();
  nodes.forEach((node) => {
    Object.keys(node.properties || {}).forEach((key) => allProps.add(key));
  });
  const columns = ["class", "id", ...Array.from(allProps).sort()];
  const rows = [columns.join(",")];
  nodes.forEach((node) => {
    const row = columns.map((col) => {
      if (col === "class") return escapeCsv(node.class);
      if (col === "id") return escapeCsv(node.id);
      return escapeCsv(node.properties?.[col] ?? "");
    });
    rows.push(row.join(","));
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sintology-table-view.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view-toggle button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  graphView.classList.toggle("hidden", view !== "graph");
  tableView.classList.toggle("hidden", view !== "table");
  render();
}

function clearFilters() {
  state.filter = "All";
  state.focusId = null;
  state.searchTerm = "";
  state.searchDepth = 2;
  classFilter.value = "All";
  searchInput.value = "";
  depthRange.value = "2";
  depthValue.textContent = "2";
  render();
}

function render() {
  updateStatus();
  if (state.view === "graph") {
    renderGraph();
  } else {
    renderTables();
  }
}

async function init() {
  try {
    const [ontology, graph] = await Promise.all([
      fetchJson(ONTOLOGY_URL),
      fetchJson(DATA_URL),
    ]);
    state.ontology = ontology;
    state.graph = graph;
    buildFilter();
    setView("graph");
    
    // Check WebGPU support and show warning if not available
    const hasWebGPU = await checkWebGPU();
    if (!hasWebGPU) {
      const warning = document.createElement('div');
      warning.className = 'webgpu-warning';
      warning.innerHTML = `
        <p>⚠️ <strong>WebGPU not available.</strong> AI features will use CPU and may be slower. 
        For best performance, use a browser with WebGPU support (Chrome 113+, Edge 113+).</p>
        <button onclick="this.parentElement.remove()">Dismiss</button>
      `;
      warning.style.cssText = `
        position: fixed; top: 80px; right: 20px; max-width: 400px;
        background: var(--surface); border: 2px solid var(--accent);
        border-radius: 12px; padding: 16px; box-shadow: 0 4px 12px var(--shadow);
        z-index: 1000; animation: slideIn 0.3s ease-out;
      `;
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .webgpu-warning button { margin-top: 8px; padding: 6px 12px; border: 1px solid var(--line); 
          background: white; border-radius: 6px; cursor: pointer; }
        .webgpu-warning button:hover { background: var(--surface-strong); }
      `;
      document.head.appendChild(style);
      document.body.appendChild(warning);
    }
  } catch (error) {
    setStatus("Failed to load ontology or data.");
    console.error(error);
  }
}

const toggleButtons = document.querySelectorAll(".view-toggle button");
toggleButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

clearFiltersBtn.addEventListener("click", clearFilters);
searchInput.addEventListener("input", (event) => {
  state.searchTerm = event.target.value.trim();
  render();
});
depthRange.addEventListener("input", (event) => {
  const value = Number(event.target.value);
  state.searchDepth = value >= state.maxDepthSentinel ? Infinity : value;
  depthValue.textContent = state.searchDepth === Infinity ? "∞" : String(value);
  render();
});
viewOntologyBtn.addEventListener("click", () => {
  ontologyContent.textContent = JSON.stringify(state.ontology, null, 2);
  ontologyModal.classList.remove("hidden");
});
closeOntologyBtn.addEventListener("click", () => {
  ontologyModal.classList.add("hidden");
});
ontologyModal.addEventListener("click", (event) => {
  if (event.target === ontologyModal) {
    ontologyModal.classList.add("hidden");
  }
});
exportViewBtn.addEventListener("click", () => {
  if (state.view === "graph") {
    exportGraphView();
  } else {
    exportTableView();
  }
});

async function initQAPipeline() {
  if (qaPipeline) {
    return qaPipeline;
  }
  
  // Show model consent modal
  const consent = await showModelConsentModal(MODEL_CONFIG.qa);
  if (!consent) {
    throw new Error("User declined model download");
  }
  
  try {
    const { pipeline: pipelineFn } = await loadTransformers();
    if (!pipelineFn) {
      throw new Error("Transformers.js not available");
    }
    
    setStatus("Loading Q&A model... This may take a moment.");
    qaPipeline = await pipelineFn(MODEL_CONFIG.qa.task, MODEL_CONFIG.qa.name);
    setStatus("Q&A model loaded.");
    return qaPipeline;
  } catch (error) {
    console.error("Error loading Q&A model:", error);
    throw error;
  }
}

function buildContextFromGraph() {
  // Build a text context from the current graph data
  const nodes = filteredNodes();
  
  if (nodes.length === 0) {
    return { context: "No data available. Please adjust filters or load data.", wasTruncated: false };
  }
  
  let context = "The following entities are in the current view:\n\n";
  const MAX_CONTEXT_LENGTH = 2000; // Limit context to avoid exceeding model input limits
  let wasTruncated = false;
  
  // Group nodes by class
  const nodesByClass = {};
  nodes.forEach(node => {
    if (!nodesByClass[node.class]) {
      nodesByClass[node.class] = [];
    }
    nodesByClass[node.class].push(node);
  });
  
  // Build context for each class
  Object.keys(nodesByClass).forEach(className => {
    if (context.length > MAX_CONTEXT_LENGTH) {
      return;
    }
    
    context += `${className} entities:\n`;
    nodesByClass[className].forEach(node => {
      if (context.length > MAX_CONTEXT_LENGTH) {
        return;
      }
      
      const label = nodeLabel(node);
      const props = node.properties || {};
      const propText = Object.entries(props)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      context += `- ${label}`;
      if (propText) {
        context += ` (${propText})`;
      }
      context += '\n';
    });
    context += '\n';
  });
  
  // Add relationship information if space allows
  if (context.length < MAX_CONTEXT_LENGTH) {
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = filteredEdges(nodeIds);
    
    if (edges.length > 0) {
      context += "Relationships:\n";
      edges.forEach(edge => {
        if (context.length > MAX_CONTEXT_LENGTH) {
          return;
        }
        const fromNode = nodeById(edge.from);
        const toNode = nodeById(edge.to);
        if (fromNode && toNode) {
          context += `- ${nodeLabel(fromNode)} ${edge.type} ${nodeLabel(toNode)}\n`;
        }
      });
    }
  }
  
  // Truncate if still too long
  if (context.length > MAX_CONTEXT_LENGTH) {
    context = context.substring(0, MAX_CONTEXT_LENGTH) + "\n...(truncated)";
    wasTruncated = true;
  }
  
  return { context, wasTruncated };
}

async function answerQuestion() {
  const question = qaInput.value.trim();
  
  if (!question) {
    alert("Please enter a question.");
    return;
  }
  
  try {
    askBtn.disabled = true;
    askBtn.textContent = "Processing...";
    
    // Initialize Q&A pipeline
    const pipeline = await initQAPipeline();
    
    // Build context from current graph view
    const { context, wasTruncated } = buildContextFromGraph();
    
    // Warn user if context was truncated
    if (wasTruncated) {
      setStatus("⚠️ Context was truncated due to length. Consider using filters to narrow down the data.");
    } else {
      setStatus("Answering question...");
    }
    
    // Get answer
    const result = await pipeline(question, context);
    
    // Display result
    const confidence = (result.score * 100).toFixed(1);
    const truncationWarning = wasTruncated ? 
      '<p class="warning" style="color: var(--accent); margin-top: 8px;">⚠️ Context was truncated. The answer may not include all available data. Try using filters to narrow down the view.</p>' : '';
    
    qaResult.innerHTML = `
      <div class="qa-result-content">
        <h3>Question:</h3>
        <p class="question">${escapeHtml(question)}</p>
        
        <h3>Answer:</h3>
        <p class="answer">${escapeHtml(result.answer)}</p>
        
        <p class="confidence">Confidence: ${confidence}%</p>
        ${truncationWarning}
        
        <details>
          <summary>Context used (click to expand)</summary>
          <pre class="context">${escapeHtml(context)}</pre>
        </details>
      </div>
    `;
    
    qaModal.classList.remove("hidden");
    setStatus("Question answered.");
  } catch (error) {
    console.error("Error answering question:", error);
    alert(`Error: ${error.message}`);
    setStatus("Error processing question.");
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = "Ask";
  }
}

askBtn.addEventListener("click", answerQuestion);
qaInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    answerQuestion();
  }
});

closeQABtn.addEventListener("click", () => {
  qaModal.classList.add("hidden");
});

qaModal.addEventListener("click", (event) => {
  if (event.target === qaModal) {
    qaModal.classList.add("hidden");
  }
});

init();
