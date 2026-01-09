# SintOlogy Web Interface - AI Features

## Overview

The SintOlogy web interface now includes AI-powered features using [Transformers.js](https://huggingface.co/docs/transformers.js) for client-side machine learning. All AI processing happens directly in the browser without requiring a backend server.

## Features

### 1. Question Answering (Main Page)

Located on the main explorer page (`index.html`), the Q&A feature allows you to ask natural language questions about the data currently displayed in the graph.

**How to use:**
1. Navigate to the main explorer page
2. Apply any filters or search to narrow down the data you want to query
3. Type your question in the "AI Q&A" input field
4. Click "Ask" or press Enter
5. The AI will analyze the current graph data and provide an answer with a confidence score

**Example questions:**
- "Who is Alex Parker?"
- "What campaigns are there?"
- "Which organization has a political wing?"
- "What actions were performed?"

**Model used:** `Xenova/distilbert-base-cased-distilled-squad` (DistilBERT fine-tuned on SQuAD)

### 2. Text Analysis Page

A dedicated page (`text-analysis.html`) for analyzing arbitrary text using AI. Access it via the "AI Text Analysis →" link in the header.

**Features:**

#### Named Entity Recognition (NER)
Extracts entities from your text:
- **PER/PERSON**: People mentioned in the text
- **ORG/ORGANISATION**: Organizations, companies, institutions
- **LOC/LOCATION**: Places, geographic locations
- **MISC**: Other named entities

#### Relationship Extraction
Identifies relationships between entities:
- Detects potential relationships from the ontology (e.g., memberOfOrganisation, performsAction)
- Shows confidence scores for each detected relationship
- Helps understand connections between entities in the text

#### Zero-Shot Classification
Classifies your text against ontology classes:
- **Existing Classes Mode**: Restricts classification to current ontology classes only
- **New Classes Mode**: Also suggests new entity/relationship classes that might be relevant
- Toggle between modes using the "Existing Classes Only" button
- Shows which ontology classes (Person, Organisation, Campaign, etc.) are most relevant to your text
- Displays confidence scores for each classification

#### Ontology Mapping
Maps extracted entities to existing ontology classes:
- Automatically maps PER → Person
- Automatically maps ORG → Organisation
- Suggests relevant ontology classes for your text
- Shows available properties for matched classes

#### Export Functionality
Export analysis results for ingestion into the graph:
- Click "Export Results" after analysis
- Exports in graph-compatible JSON format with nodes and edges
- Includes metadata, confidence scores, and timestamps
- Can be loaded directly using the ingestion CLI

**How to use:**
1. Navigate to the Text Analysis page
2. (Optional) Toggle "Existing Classes Only" to allow new class detection
3. Paste or type your text in the input area
4. Click "Analyze Text"
5. Review model consent modal and accept to download models (first time only)
6. Wait for models to load (~5-30 seconds on first use)
7. View the extracted entities, relationships, classifications, and ontology mappings
8. Click "Export Results" to download in graph format

**Models used:**
- [`Xenova/bert-base-NER`](https://huggingface.co/Xenova/bert-base-NER) for entity extraction
- [`Xenova/distilbert-base-uncased-mnli`](https://huggingface.co/Xenova/distilbert-base-uncased-mnli) for zero-shot classification and relationship extraction

## Technical Details

### Architecture
- **Client-side only**: All AI processing happens in your browser using WebAssembly and WebGPU when available
- **No backend required**: Models are loaded from CDN and cached locally
- **Privacy-friendly**: Your data never leaves your browser

### Performance
- **First load**: Models download on first use (~10-50MB per model, one-time)
  - User must consent to model download via modal before first use
  - Model information including size and Hugging Face link provided
- **Subsequent uses**: Models are cached in browser, instant loading
- **Processing time**: 1-5 seconds depending on text length and device
- **WebGPU acceleration**: Automatically used when available for faster inference
  - Warning shown on startup if WebGPU not available
  - Falls back to CPU (slower but still functional)

### Requirements
- Modern web browser (Chrome 90+, Firefox 89+, Safari 15+, Edge 90+)
- JavaScript enabled
- Internet connection for initial model download
- Recommended: 4GB+ RAM for optimal performance
- For best performance: WebGPU support (Chrome 113+, Edge 113+)

### Browser Compatibility
- ✅ Chrome/Edge 113+ (best performance with WebGPU)
- ✅ Chrome/Edge 90-112 (works on CPU)
- ✅ Firefox (CPU only, slower but functional)
- ✅ Safari (CPU only, slower but functional)
- ⚠️ May not work with strict content blockers or security policies that block CDN access

### Troubleshooting

**"Failed to load Transformers.js" error:**
- Check your internet connection
- Disable content blockers (uBlock Origin, etc.) for this site
- Try a different browser
- Check browser console for specific error messages

**Models taking too long to load:**
- First load requires downloading models (10-50MB), be patient
- Check your internet speed
- Models are cached after first load for instant future use

**Out of memory errors:**
- Close other browser tabs
- Try processing shorter text
- Restart your browser
- Use a device with more RAM

## Development

### Files
- `web/index.html` - Main explorer page with Q&A feature
- `web/app.js` - Main application logic including Q&A integration
- `web/text-analysis.html` - Text analysis page
- `web/text-analysis.js` - Text analysis logic with NER and classification
- `web/styles.css` - Styling for all features

### Customization

Models are configured centrally in `MODEL_CONFIG` objects for easy updates:

```javascript
// In app.js for Q&A
const MODEL_CONFIG = {
  qa: {
    name: 'Xenova/distilbert-base-cased-distilled-squad',
    task: 'question-answering',
    size: '~250MB',
    url: 'https://huggingface.co/Xenova/distilbert-base-cased-distilled-squad'
  }
};

// In text-analysis.js for NER and classification
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
};
```

To use different models:
1. Update the model name in `MODEL_CONFIG`
2. Update the task type if needed
3. Update size estimate for user information
4. Update the Hugging Face URL to the new model card

Available models: [Transformers.js Models](https://huggingface.co/models?library=transformers.js)

## Future Enhancements

Potential additions:
- ✅ Relationship extraction (implemented)
- ✅ Export to graph format (implemented)
- Summarization of long text passages for table view
- Sentiment analysis for posts
- Automatic entity linking to existing graph nodes
- Export analysis results to graph format
- Batch processing of multiple texts

## Credits

Built with:
- [Transformers.js](https://github.com/xenova/transformers.js) by Xenova
- Models from [Hugging Face](https://huggingface.co/)
