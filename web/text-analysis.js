import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Configure to use local models (avoid CORS issues)
env.allowRemoteModels = true;
env.allowLocalModels = false;

const ONTOLOGY_URL = "/ontology/ontology.json";

// Configuration constants
const CONFIDENCE_THRESHOLD = 0.1; // Minimum confidence score for displaying results
const EXPORT_TEXT_PREVIEW_LENGTH = 100; // Characters to include in export preview
const EXPORT_METADATA_LENGTH = 200; // Characters for export metadata

// Additional class labels for new class detection mode
const ADDITIONAL_CLASS_LABELS = ['Article', 'Document', 'Event', 'Location', 'Topic'];

// Model configuration for easy future updates
const MODEL_CONFIG = {
  ner: {
    name: 'Xenova/bert-base-NER',
    task: 'token-classification',
    size: '~420MB',
    url: 'https://huggingface.co/Xenova/bert-base-NER'
  },
  classifier: {
    name: 'Xenova/distilbert-base-uncased-mnli',
    task: 'zero-shot-classification',
    size: '~260MB',
    url: 'https://huggingface.co/Xenova/distilbert-base-uncased-mnli'
  }
  // Note: relationExtraction reuses classifier model
};

const state = {
  ontology: null,
  nerPipeline: null,
  classifierPipeline: null,
  relationPipeline: null,
  isLoading: false,
  useExistingClassesOnly: true, // Toggle for existing vs new classes
  lastAnalysisResults: null // Store results for export
};

const statusEl = document.getElementById("status");
const inputText = document.getElementById("inputText");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");
const entitiesResult = document.getElementById("entitiesResult");
const relationshipsResult = document.getElementById("relationshipsResult");
const ontologyMapping = document.getElementById("ontologyMapping");

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function fetchJson(url) {
  return fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(`Failed to load ${url}`);
    }
    return res.json();
  });
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

async function initializeModels() {
  if (state.nerPipeline && state.classifierPipeline) {
    return;
  }

  try {
    state.isLoading = true;
    analyzeBtn.disabled = true;

    // Initialize NER pipeline for entity extraction
    if (!state.nerPipeline) {
      const consent = await showModelConsentModal(MODEL_CONFIG.ner);
      if (!consent) {
        throw new Error("User declined model download");
      }
      
      setStatus("Loading Named Entity Recognition model...");
      state.nerPipeline = await pipeline(MODEL_CONFIG.ner.task, MODEL_CONFIG.ner.name);
    }

    // Initialize zero-shot classification for relationship/class classification
    if (!state.classifierPipeline) {
      const consent = await showModelConsentModal(MODEL_CONFIG.classifier);
      if (!consent) {
        throw new Error("User declined model download");
      }
      
      setStatus("Loading Zero-Shot Classification model...");
      state.classifierPipeline = await pipeline(MODEL_CONFIG.classifier.task, MODEL_CONFIG.classifier.name);
      // Reuse classifier for relationship extraction (same model, same task)
      state.relationPipeline = state.classifierPipeline;
    }

    state.isLoading = false;
    analyzeBtn.disabled = false;
    setStatus("Models loaded. Ready to analyze text.");
  } catch (error) {
    console.error("Error loading models:", error);
    setStatus(`Error loading models: ${error.message}`);
    state.isLoading = false;
    analyzeBtn.disabled = false;
  }
}

function consolidateEntityToken(entityType, item, entities) {
  // Handle BERT tokenization patterns:
  // - 'B-' prefix indicates beginning of entity
  // - 'I-' prefix indicates inside/continuation of entity
  // - '##' prefix indicates subword token
  
  if (!entities[entityType] || entities[entityType].length === 0) {
    // First entity of this type
    entities[entityType].push({
      word: item.word.replace('##', ''),
      score: item.score,
      start: item.start,
      end: item.end
    });
    return;
  }
  
  const lastEntity = entities[entityType][entities[entityType].length - 1];
  
  if (item.entity.startsWith('I-') && item.start === lastEntity.end) {
    // Continuation of previous entity - merge tokens
    lastEntity.word += item.word.replace('##', '');
    lastEntity.end = item.end;
    lastEntity.score = (lastEntity.score + item.score) / 2;
  } else {
    // New entity
    entities[entityType].push({
      word: item.word.replace('##', ''),
      score: item.score,
      start: item.start,
      end: item.end
    });
  }
}

async function performNER(text) {
  try {
    const result = await state.nerPipeline(text);
    
    // Group entities by type
    const entities = {};
    result.forEach(item => {
      const entityType = item.entity.replace('B-', '').replace('I-', '');
      if (!entities[entityType]) {
        entities[entityType] = [];
      }
      
      consolidateEntityToken(entityType, item, entities);
    });

    return entities;
  } catch (error) {
    console.error("Error in NER:", error);
    throw error;
  }
}

async function performClassification(text) {
  try {
    // Get ontology classes for classification
    const classLabels = state.useExistingClassesOnly 
      ? state.ontology.classes.map(c => c.label || c.name)
      : [...state.ontology.classes.map(c => c.label || c.name), ...ADDITIONAL_CLASS_LABELS];
    
    // Classify text against ontology classes
    const result = await state.classifierPipeline(text, classLabels, {
      multi_label: true
    });

    return result;
  } catch (error) {
    console.error("Error in classification:", error);
    throw error;
  }
}

async function extractRelationships(text, entities) {
  try {
    // Get relationship types from ontology
    const relationshipTypes = state.ontology.properties
      .filter(p => p.kind === 'object')
      .map(p => p.name);
    
    if (relationshipTypes.length === 0) {
      return null;
    }
    
    // Use zero-shot classification to identify potential relationships
    const result = await state.relationPipeline(text, relationshipTypes, {
      multi_label: true
    });
    
    return result;
  } catch (error) {
    console.error("Error in relationship extraction:", error);
    return null;
  }
}

function mapEntitiesToOntology(entities) {
  // Map NER entity types to ontology classes
  // Note: Both British and American spellings supported for entity recognition
  const mapping = {
    PER: 'Person',
    PERSON: 'Person',
    ORG: 'Organisation',
    ORGANISATION: 'Organisation',
    ORGANIZATION: 'Organisation',  // American spelling variant
    // Note: Location entities don't have a direct ontology class mapping
    // LOC and LOCATION are kept as-is for now
  };

  const ontologyEntities = {};
  
  Object.keys(entities).forEach(entityType => {
    const ontologyClass = mapping[entityType.toUpperCase()];
    if (ontologyClass) {
      if (!ontologyEntities[ontologyClass]) {
        ontologyEntities[ontologyClass] = [];
      }
      ontologyEntities[ontologyClass].push(...entities[entityType]);
    }
  });

  return ontologyEntities;
}

function renderEntities(entities) {
  if (!entities || Object.keys(entities).length === 0) {
    entitiesResult.innerHTML = '<p class="placeholder">No entities found.</p>';
    return;
  }

  let html = '<div class="entity-groups">';
  
  Object.keys(entities).forEach(entityType => {
    const items = entities[entityType];
    if (items.length === 0) return;
    
    html += `<div class="entity-group">`;
    html += `<h3>${escapeHtml(entityType)}</h3>`;
    html += `<ul class="entity-list">`;
    
    items.forEach(item => {
      const confidence = (item.score * 100).toFixed(1);
      html += `<li><span class="entity-word">${escapeHtml(item.word)}</span> <span class="confidence">(${confidence}%)</span></li>`;
    });
    
    html += `</ul></div>`;
  });
  
  html += '</div>';
  entitiesResult.innerHTML = html;
}

function renderClassification(classification, relationships) {
  if (!classification || !classification.labels) {
    relationshipsResult.innerHTML = '<p class="placeholder">No classification results.</p>';
    return;
  }

  let html = '<div class="classification-results">';
  
  // Show ontology classifications
  html += '<h3>Ontology Classifications</h3>';
  html += '<ul class="classification-list">';
  
  classification.labels.forEach((label, idx) => {
    const score = classification.scores[idx];
    if (score > CONFIDENCE_THRESHOLD) {
      const confidence = (score * 100).toFixed(1);
      html += `<li><span class="class-label">${escapeHtml(label)}</span> <span class="confidence">(${confidence}%)</span></li>`;
    }
  });
  
  html += '</ul>';
  
  // Show relationships if available
  if (relationships && relationships.labels) {
    html += '<h3 style="margin-top: 20px;">Detected Relationships</h3>';
    html += '<ul class="classification-list">';
    
    relationships.labels.forEach((label, idx) => {
      const score = relationships.scores[idx];
      if (score > CONFIDENCE_THRESHOLD) {
        const confidence = (score * 100).toFixed(1);
        html += `<li><span class="class-label">${escapeHtml(label)}</span> <span class="confidence">(${confidence}%)</span></li>`;
      }
    });
    
    html += '</ul>';
  }
  
  html += '</div>';
  relationshipsResult.innerHTML = html;
}

function renderOntologyMapping(entities, classification) {
  let html = '<div class="ontology-mapping-results">';
  
  // Show entity mappings
  if (entities && Object.keys(entities).length > 0) {
    html += '<h3>Entity Mappings</h3>';
    html += '<ul class="mapping-list">';
    
    Object.keys(entities).forEach(ontologyClass => {
      const items = entities[ontologyClass];
      if (items.length > 0) {
        const escapedItems = items.map(i => escapeHtml(i.word)).join(', ');
        html += `<li><strong>${escapeHtml(ontologyClass)}:</strong> ${escapedItems}</li>`;
      }
    });
    
    html += '</ul>';
  }
  
  // Show possible relationships from ontology
  if (classification && classification.labels) {
    html += '<h3>Suggested Ontology Classes</h3>';
    html += '<ul class="mapping-list">';
    
    const topClasses = classification.labels.slice(0, 5);
    topClasses.forEach((label, idx) => {
      const score = classification.scores[idx];
      if (score > CONFIDENCE_THRESHOLD) {
        const confidence = (score * 100).toFixed(1);
        
        // Find matching ontology class
        const ontologyClass = state.ontology.classes.find(c => 
          (c.label || c.name) === label
        );
        
        if (ontologyClass) {
          // Find properties for this class
          const properties = state.ontology.properties.filter(p => 
            p.domain && p.domain.includes(ontologyClass.name)
          );
          
          const propNames = properties.map(p => escapeHtml(p.name || '')).filter(n => n).join(', ');
          html += `<li><strong>${escapeHtml(label)}</strong> (${confidence}%)`;
          if (propNames) {
            html += `<br/><span class="properties">Properties: ${propNames}</span>`;
          }
          html += `</li>`;
        }
      }
    });
    
    html += '</ul>';
  }
  
  // Suggest potential new entity/relationship classes
  html += '<h3>Analysis Summary</h3>';
  html += '<p class="summary">The text has been analyzed against the existing ontology. ';
  html += 'Entities have been extracted and mapped to ontology classes where possible. ';
  html += 'The classification suggests which ontology classes are most relevant to this text.</p>';
  
  html += '</div>';
  ontologyMapping.innerHTML = html;
}

async function analyzeText() {
  const text = inputText.value.trim();
  
  if (!text) {
    setStatus("Please enter some text to analyze.");
    return;
  }

  try {
    setStatus("Initializing AI models...");
    await initializeModels();

    setStatus("Extracting named entities...");
    analyzeBtn.disabled = true;
    
    // Perform NER
    const entities = await performNER(text);
    renderEntities(entities);
    
    setStatus("Classifying text against ontology...");
    
    // Perform classification
    const classification = await performClassification(text);
    
    setStatus("Extracting relationships...");
    
    // Extract relationships
    const relationships = await extractRelationships(text, entities);
    renderClassification(classification, relationships);
    
    // Map to ontology
    const ontologyEntities = mapEntitiesToOntology(entities);
    renderOntologyMapping(ontologyEntities, classification);
    
    // Store results for export
    state.lastAnalysisResults = {
      text,
      entities,
      classification,
      relationships,
      ontologyEntities,
      timestamp: new Date().toISOString()
    };
    
    setStatus("Analysis complete.");
    analyzeBtn.disabled = false;
  } catch (error) {
    console.error("Error analyzing text:", error);
    setStatus(`Error: ${error.message}`);
    analyzeBtn.disabled = false;
  }
}

function exportResults() {
  if (!state.lastAnalysisResults) {
    alert("No analysis results to export. Please analyze some text first.");
    return;
  }
  
  const results = state.lastAnalysisResults;
  
  // Convert to graph-compatible format
  const nodes = [];
  const edges = [];
  let nodeIdCounter = 0;
  
  // Add entities as nodes
  Object.keys(results.ontologyEntities).forEach(ontologyClass => {
    results.ontologyEntities[ontologyClass].forEach(entity => {
      // Sanitize class name for ID generation
      const sanitizedClass = ontologyClass.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const nodeId = `extracted-${sanitizedClass}-${nodeIdCounter++}`;
      nodes.push({
        id: nodeId,
        class: ontologyClass,
        properties: {
          name: entity.word,
          extractedFrom: results.text.substring(0, EXPORT_TEXT_PREVIEW_LENGTH) + '...',
          confidence: entity.score,
          extractedAt: results.timestamp
        }
      });
    });
  });
  
  // Create export object
  const exportData = {
    metadata: {
      exportedAt: new Date().toISOString(),
      source: 'SintOlogy Text Analysis',
      textAnalyzed: results.text.substring(0, EXPORT_METADATA_LENGTH) + (results.text.length > EXPORT_METADATA_LENGTH ? '...' : '')
    },
    nodes,
    edges,
    rawAnalysis: {
      entities: results.entities,
      classifications: results.classification,
      relationships: results.relationships
    }
  };
  
  // Download as JSON
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sintology-text-analysis-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  
  setStatus("Results exported successfully.");
}

function toggleClassMode() {
  state.useExistingClassesOnly = !state.useExistingClassesOnly;
  const toggle = document.getElementById('classModeToggle');
  if (toggle) {
    toggle.textContent = state.useExistingClassesOnly ? 'Existing Classes Only' : 'Include New Classes';
    toggle.title = state.useExistingClassesOnly 
      ? 'Click to allow detection of new entity/relationship classes'
      : 'Click to restrict to existing ontology classes only';
  }
  setStatus(state.useExistingClassesOnly 
    ? 'Mode: Existing ontology classes only' 
    : 'Mode: Will suggest new classes if relevant');
}

function clearAll() {
  inputText.value = "";
  entitiesResult.innerHTML = '<p class="placeholder">Entities will appear here after analysis.</p>';
  relationshipsResult.innerHTML = '<p class="placeholder">Relationship classifications will appear here after analysis.</p>';
  ontologyMapping.innerHTML = '<p class="placeholder">Ontology class mappings will appear here after analysis.</p>';
  setStatus("Ready. Paste text below to analyze.");
}

async function init() {
  try {
    state.ontology = await fetchJson(ONTOLOGY_URL);
    setStatus("Ready. Paste text below to analyze.");
  } catch (error) {
    setStatus("Failed to load ontology.");
    console.error(error);
  }
}

analyzeBtn.addEventListener("click", analyzeText);
clearBtn.addEventListener("click", clearAll);

// Add export and toggle listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const exportBtn = document.getElementById('exportBtn');
  const classModeToggle = document.getElementById('classModeToggle');
  
  if (exportBtn) {
    exportBtn.addEventListener('click', exportResults);
  }
  
  if (classModeToggle) {
    classModeToggle.addEventListener('click', toggleClassMode);
  }
});

init();
