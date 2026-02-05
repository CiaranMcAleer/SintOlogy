// Text Analysis now runs in a Web Worker to prevent browser freezing
// Models are loaded in background thread: text-analysis-worker.js

// Web Worker state
let textAnalysisWorker = null;
let workerReady = false;

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
          <p>This feature requires downloading AI models:</p>
          <ul style="margin: 16px 0; padding-left: 24px;">
            <li><strong>Model:</strong> ${modelInfo.name}</li>
            <li><strong>Size:</strong> ${modelInfo.size}</li>
            <li><strong>Task:</strong> ${modelInfo.task}</li>
          </ul>
          <p>The models will be downloaded once and cached in your browser for future use.</p>
          <p><strong>Note:</strong> Models run in a background thread to keep the interface responsive.</p>
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
    
    // Helper to safely remove modal
    const removeModal = () => {
      try {
        if (modal && modal.parentNode === document.body) {
          document.body.removeChild(modal);
        }
      } catch (e) {
        console.warn('Modal already removed:', e);
      }
    };
    
    document.getElementById('cancelModel').onclick = () => {
      removeModal();
      resolve(false);
    };
    
    document.getElementById('acceptModel').onclick = () => {
      removeModal();
      resolve(true);
    };
    
    modal.onclick = (e) => {
      if (e.target === modal) {
        removeModal();
        resolve(false);
      }
    };
  });
}

async function initWorker() {
  if (workerReady) {
    return;
  }
  
  if (!textAnalysisWorker) {
    // Ask for consent before initializing worker
    const consent = await showModelConsentModal({
      name: 'NER + Classification Models',
      size: '~680MB total (NER: ~420MB, Classifier: ~260MB)',
      task: 'Entity extraction and zero-shot classification',
      url: 'https://huggingface.co/Xenova'
    });
    
    if (!consent) {
      throw new Error("User declined model download");
    }
    
    setStatus("Initializing Web Worker...");
    
    // Create worker
    textAnalysisWorker = new Worker('/web/text-analysis-worker.js', { type: 'module' });
    
    // Set up message handler
    textAnalysisWorker.addEventListener('message', (event) => {
      const { type, message } = event.data;
      
      if (type === 'status') {
        setStatus(message);
      } else if (type === 'ready') {
        workerReady = true;
        setStatus("Models loaded. Ready to analyze text.");
        analyzeBtn.disabled = false;
      } else if (type === 'error') {
        console.error('Worker error:', event.data.error);
        setStatus(`Error: ${event.data.error}`);
        analyzeBtn.disabled = false;
      }
    });
    
    // Initialize models in worker
    textAnalysisWorker.postMessage({
      type: 'init',
      data: {
        nerModel: MODEL_CONFIG.ner.name,
        classifierModel: MODEL_CONFIG.classifier.name
      }
    });
  }
  
  // Wait for worker to be ready
  return new Promise((resolve, reject) => {
    const checkReady = setInterval(() => {
      if (workerReady) {
        clearInterval(checkReady);
        resolve();
      }
    }, 100);
    
    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(checkReady);
      reject(new Error('Worker initialization timeout'));
    }, 300000);
  });
}

async function initializeModels() {
  if (workerReady) {
    return;
  }

  try {
    state.isLoading = true;
    analyzeBtn.disabled = true;
    
    await initWorker();

    state.isLoading = false;
    analyzeBtn.disabled = false;
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
  // - '##' prefix indicates subword token (no space needed)
  // - Regular tokens need spaces between them
  
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
    // Add space unless this is a subword token (starts with ##)
    const isSubword = item.word.startsWith('##');
    const cleanWord = item.word.replace('##', '');
    lastEntity.word += isSubword ? cleanWord : ' ' + cleanWord;
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

function mergeAdjacentFragments(entities, originalText, entityType) {
  // Merge entities that are very close together and likely fragments of the same entity
  // e.g., "C", "iara", "n McAleer" -> "Ciaran McAleer"
  // e.g., "Ciaran", "McAleer" -> "Ciaran McAleer" (for PER type)
  // e.g., "Trustie", "Labs" -> "Trustie Labs" (for ORG type)
  
  if (entities.length <= 1) {
    return entities;
  }
  
  const merged = [];
  let current = entities[0];
  
  for (let i = 1; i < entities.length; i++) {
    const next = entities[i];
    
    // Check if entities are adjacent or very close
    const gap = next.start - current.end;
    
    // Merge if entities are adjacent AND look like they belong together:
    const isAdjacent = gap <= 2;
    const currentIsFragment = current.word.length <= 2;
    const nextIsFragment = next.word.length <= 2;
    const bothAreShort = current.word.length <= 4 && next.word.length <= 4;
    
    // For person names and organizations, be more aggressive about merging
    // Names like "Ciaran McAleer" or "Trustie Labs" should be merged
    const isNameLikeType = entityType && (
      entityType.toLowerCase() === 'per' || 
      entityType.toLowerCase() === 'person' ||
      entityType.toLowerCase() === 'org' ||
      entityType.toLowerCase() === 'organisation' ||
      entityType.toLowerCase() === 'organization'
    );
    
    const looksLikeMultiWordName = isNameLikeType && gap === 1 && 
                                   current.word.length <= 20 && next.word.length <= 20 &&
                                   /^[A-Z]/.test(current.word) && /^[A-Z]/.test(next.word); // Both start with capital
    
    const shouldMerge = isAdjacent && (currentIsFragment || nextIsFragment || bothAreShort || looksLikeMultiWordName);
    
    if (shouldMerge) {
      // Extract the actual text between entities from original text
      const actualText = originalText.substring(current.start, next.end);
      
      // Merge the entities
      current = {
        word: actualText,
        score: (current.score + next.score) / 2,
        start: current.start,
        end: next.end
      };
    } else {
      // Not adjacent enough, save current and move to next
      merged.push(current);
      current = next;
    }
  }
  
  // Don't forget the last entity
  merged.push(current);
  
  return merged;
}

async function performNER(text) {
  if (!workerReady) {
    throw new Error('Worker not ready');
  }
  
  return new Promise((resolve, reject) => {
    const handleResult = (event) => {
      const { type, result, error } = event.data;
      
      if (type === 'ner-result') {
        textAnalysisWorker.removeEventListener('message', handleResult);
        
        // Calculate start/end positions if not provided by the model
        // Some models only provide index, so we need to calculate actual text positions
        let currentPosition = 0;
        result.forEach((item, idx) => {
          if (!item.start || !item.end) {
            // Find this token in the original text starting from currentPosition
            const cleanWord = item.word.replace('##', '');
            const searchStart = currentPosition;
            
            // Search for the word in the remaining text
            let foundIndex = text.indexOf(cleanWord, searchStart);
            
            // If not found, try case-insensitive search
            if (foundIndex === -1) {
              const lowerText = text.toLowerCase();
              const lowerWord = cleanWord.toLowerCase();
              foundIndex = lowerText.indexOf(lowerWord, searchStart);
            }
            
            if (foundIndex !== -1) {
              item.start = foundIndex;
              item.end = foundIndex + cleanWord.length;
              currentPosition = item.end;
            } else {
              // Fallback: estimate based on previous token
              item.start = currentPosition;
              item.end = currentPosition + cleanWord.length;
              currentPosition = item.end + 1; // +1 for space
            }
          }
        });
        
        // Group entities by type
        const entities = {};
        result.forEach(item => {
          const entityType = item.entity.replace('B-', '').replace('I-', '');
          if (!entities[entityType]) {
            entities[entityType] = [];
          }
          
          consolidateEntityToken(entityType, item, entities);
        });
        
        // Post-process: merge adjacent entities that are likely fragments of the same entity
        Object.keys(entities).forEach(entityType => {
          entities[entityType] = mergeAdjacentFragments(entities[entityType], text, entityType);
        });
        
        resolve(entities);
      } else if (type === 'error') {
        textAnalysisWorker.removeEventListener('message', handleResult);
        reject(new Error(error));
      }
    };
    
    textAnalysisWorker.addEventListener('message', handleResult);
    
    textAnalysisWorker.postMessage({
      type: 'ner',
      data: { text }
    });
  });
}

async function performClassification(text) {
  if (!workerReady) {
    throw new Error('Worker not ready');
  }
  
  // Get ontology classes for classification
  const classLabels = state.useExistingClassesOnly 
    ? state.ontology.classes.map(c => c.label || c.name)
    : [...state.ontology.classes.map(c => c.label || c.name), ...ADDITIONAL_CLASS_LABELS];
  
  return new Promise((resolve, reject) => {
    const handleResult = (event) => {
      const { type, result, error } = event.data;
      
      if (type === 'classify-result') {
        textAnalysisWorker.removeEventListener('message', handleResult);
        resolve(result);
      } else if (type === 'error') {
        textAnalysisWorker.removeEventListener('message', handleResult);
        reject(new Error(error));
      }
    };
    
    textAnalysisWorker.addEventListener('message', handleResult);
    
    textAnalysisWorker.postMessage({
      type: 'classify',
      data: { 
        text, 
        labels: classLabels,
        options: { multi_label: true }
      }
    });
  });
}

async function extractRelationships(text, entities) {
  if (!workerReady) {
    throw new Error('Worker not ready');
  }
  
  // Get relationship types from ontology
  const relationshipTypes = state.ontology.properties
    .filter(p => p.kind === 'object')
    .map(p => p.name);
  
  if (relationshipTypes.length === 0) {
    return null;
  }
  
  return new Promise((resolve, reject) => {
    const handleResult = (event) => {
      const { type, result, error } = event.data;
      
      if (type === 'classify-result') {
        textAnalysisWorker.removeEventListener('message', handleResult);
        resolve(result);
      } else if (type === 'error') {
        textAnalysisWorker.removeEventListener('message', handleResult);
        reject(new Error(error));
      }
    };
    
    textAnalysisWorker.addEventListener('message', handleResult);
    
    textAnalysisWorker.postMessage({
      type: 'classify',
      data: { 
        text, 
        labels: relationshipTypes,
        options: { multi_label: true }
      }
    });
  });
}

function mapEntitiesToOntology(entities, classification) {
  // Map NER entities to ontology classes using zero-shot classification results
  // This approach is ontology-agnostic - no hardcoded class names
  
  if (!classification || !classification.labels || !state.ontology) {
    return {};
  }
  
  const ontologyEntities = {};
  
  // Get top-scoring ontology classes from classification
  // These represent what the AI thinks are the most relevant ontology classes for the text
  const relevantClasses = classification.labels
    .map((label, idx) => ({ label, score: classification.scores[idx] }))
    .filter(c => c.score > CONFIDENCE_THRESHOLD)
    .slice(0, 10); // Top 10 classes
  
  // For each NER entity type, try to find a matching ontology class
  Object.keys(entities).forEach(entityType => {
    const items = entities[entityType];
    if (items.length === 0) return;
    
    // Try to find matching ontology class by fuzzy name matching
    // Look for classes whose names are similar to the entity type
    const entityTypeNormalized = entityType.toLowerCase().replace(/[^a-z]/g, '');
    
    // First, check if any relevant ontology class name matches the entity type
    let matchedClass = relevantClasses.find(c => {
      const classNameNormalized = c.label.toLowerCase().replace(/[^a-z]/g, '');
      // Check for similarity (contains, starts with, ends with)
      return classNameNormalized.includes(entityTypeNormalized) || 
             entityTypeNormalized.includes(classNameNormalized) ||
             (entityTypeNormalized.length > 3 && classNameNormalized.startsWith(entityTypeNormalized.substring(0, 3)));
    });
    
    // If found a match, use it
    if (matchedClass) {
      if (!ontologyEntities[matchedClass.label]) {
        ontologyEntities[matchedClass.label] = [];
      }
      ontologyEntities[matchedClass.label].push(...items);
    }
    // Otherwise, keep the NER entity type as-is (don't force incorrect mappings)
    // The zero-shot classifier already provides ontology class suggestions
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
    const ontologyEntities = mapEntitiesToOntology(entities, classification);
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
