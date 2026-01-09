import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Configure to use local models (avoid CORS issues)
env.allowRemoteModels = true;
env.allowLocalModels = false;

const ONTOLOGY_URL = "/ontology/ontology.json";

const state = {
  ontology: null,
  nerPipeline: null,
  classifierPipeline: null,
  isLoading: false
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

async function initializeModels() {
  if (state.nerPipeline && state.classifierPipeline) {
    return;
  }

  try {
    setStatus("Loading AI models... This may take a moment on first load.");
    state.isLoading = true;
    analyzeBtn.disabled = true;

    // Initialize NER pipeline for entity extraction
    if (!state.nerPipeline) {
      setStatus("Loading Named Entity Recognition model...");
      state.nerPipeline = await pipeline('token-classification', 'Xenova/bert-base-NER');
    }

    // Initialize zero-shot classification for relationship/class classification
    if (!state.classifierPipeline) {
      setStatus("Loading Zero-Shot Classification model...");
      state.classifierPipeline = await pipeline('zero-shot-classification', 'Xenova/distilbert-base-uncased-mnli');
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
      
      // Check if this is a continuation of the previous entity based on token positions
      const lastEntity = entities[entityType][entities[entityType].length - 1];
      if (lastEntity && item.entity.startsWith('I-') && 
          item.start === lastEntity.end) {
        lastEntity.word += item.word.replace('##', '');
        lastEntity.end = item.end;
        lastEntity.score = (lastEntity.score + item.score) / 2;
      } else {
        entities[entityType].push({
          word: item.word.replace('##', ''),
          score: item.score,
          start: item.start,
          end: item.end
        });
      }
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
    const classLabels = state.ontology.classes.map(c => c.label || c.name);
    
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

function mapEntitiesToOntology(entities) {
  const mapping = {
    PER: 'Person',
    PERSON: 'Person',
    ORG: 'Organisation',
    ORGANISATION: 'Organisation',
    ORGANIZATION: 'Organisation',
    // Note: Location entities don't have a direct ontology class mapping
    // LOC and LOCATION are kept as-is for now
    MISC: null  // Miscellaneous doesn't map directly
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

function renderClassification(classification) {
  if (!classification || !classification.labels) {
    relationshipsResult.innerHTML = '<p class="placeholder">No classification results.</p>';
    return;
  }

  let html = '<div class="classification-results">';
  html += '<ul class="classification-list">';
  
  classification.labels.forEach((label, idx) => {
    const score = classification.scores[idx];
    if (score > 0.1) {  // Only show results with >10% confidence
      const confidence = (score * 100).toFixed(1);
      html += `<li><span class="class-label">${escapeHtml(label)}</span> <span class="confidence">(${confidence}%)</span></li>`;
    }
  });
  
  html += '</ul></div>';
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
      if (score > 0.1) {
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
          
          const propNames = properties.map(p => escapeHtml(p.name)).join(', ');
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
    renderClassification(classification);
    
    // Map to ontology
    const ontologyEntities = mapEntitiesToOntology(entities);
    renderOntologyMapping(ontologyEntities, classification);
    
    setStatus("Analysis complete.");
    analyzeBtn.disabled = false;
  } catch (error) {
    console.error("Error analyzing text:", error);
    setStatus(`Error: ${error.message}`);
    analyzeBtn.disabled = false;
  }
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

init();
